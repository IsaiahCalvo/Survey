// Durable billing I/O: one admitted POST; read-only positive recovery thereafter.
// Never treat transport failure, elapsed time, or an empty search as no creation.
export const BILLING_API_VERSION = '2026-02-25.clover';
export class BillingPendingError extends Error {
  code = 'billing-pending';
  constructor(message = 'Billing work is still pending. Please retry later or contact support.') { super(message); }
}
export class BillingClosedError extends Error {
  code = 'account-closing';
  constructor() { super('This account is closing. New billing work is disabled.'); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const customerPattern = /^cus_[A-Za-z0-9]+$/;
const kinds = new Set(['customer_create', 'checkout_create', 'portal_create']);
const object = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v);
const canonical = (v: any): string => JSON.stringify(v, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const equal = (a: any, b: any) => canonical(a) === canonical(b);
function pending(condition: unknown, message = 'Could not verify the billing receipt.'): asserts condition {
  if (!condition) throw new BillingPendingError(message);
}
type Budget = { deadline: number; timeout: number };
const budgetFor = (requestTimeoutMs = 15000, maxDurationMs = 45000): Budget => {
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 15000
    || !Number.isInteger(maxDurationMs) || maxDurationMs < 1 || maxDurationMs > 45000) throw new BillingPendingError('Invalid billing work budget.');
  return { deadline: Date.now() + maxDurationMs, timeout: requestTimeoutMs };
};
async function timed<T>(work: () => Promise<T>, budget: Budget): Promise<T> {
  const remaining = Math.min(budget.timeout, budget.deadline - Date.now());
  if (remaining <= 0) throw new BillingPendingError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new BillingPendingError()), remaining);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function rpc(db: any, name: string, args: any, budget: Budget) {
  let response: any;
  try { response = await timed(() => db.rpc(name, args), budget); }
  catch { throw new BillingPendingError(); }
  if (response?.error) {
    if (response.error.code === '23514' && /ACCOUNT_CLOSING/.test(response.error.message || '')) throw new BillingClosedError();
    throw new BillingPendingError();
  }
  return response?.data;
}
function assertScope(scope: any) {
  pending(object(scope) && Object.keys(scope).length === 3 && ['test', 'live'].includes(scope.mode)
    && /^acct_[A-Za-z0-9]+$/.test(scope.account) && scope.api_version === BILLING_API_VERSION,
  'Billing provider identity could not be verified.');
}
export async function resolveBillingProviderScope(stripe: any, secretKey: string, requestTimeoutMs = 15000) {
  const match = /^(?:sk|rk)_(test|live)_[A-Za-z0-9]+$/.exec(secretKey || '');
  pending(match, 'Billing provider mode is not configured.');
  const account: any = await timed(() => stripe.accounts.retrieveCurrent(), budgetFor(requestTimeoutMs));
  const scope = { mode: match[1], account: account?.id, api_version: BILLING_API_VERSION };
  assertScope(scope); return scope;
}
export async function billingSpecDigest(spec: any) {
  pending(object(spec) && new TextEncoder().encode(canonical(spec)).length <= 16384);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(spec)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
const operationArgs = (op: any) => ({ p_operation_id: op.operation_id, p_user_id: op.user_id, p_kind: op.kind,
  p_provider_scope: op.provider_scope, p_request_spec: op.request_spec, p_expected_customer_id: op.expected_customer_id });
function validateOperation(op: any, userId: string, scope: any) {
  assertScope(scope);
  pending(object(op) && uuid.test(op.operation_id) && op.user_id === userId && kinds.has(op.kind)
    && equal(op.provider_scope, scope) && object(op.request_spec)
    && ['pending', 'settled'].includes(op.state) && Number.isFinite(Date.parse(op.admitted_at)));
  pending(op.kind === 'customer_create' ? op.expected_customer_id === null : customerPattern.test(op.expected_customer_id));
  return op;
}
function usableUrl(url: any) {
  if (typeof url !== 'string') return false;
  try { const value = new URL(url); return value.protocol === 'https:' && !value.username && !value.password
    && ['checkout.stripe.com', 'billing.stripe.com'].includes(value.hostname); } catch { return false; }
}
function validateResult(op: any, result: any) {
  pending(object(result) && object(result.data));
  if (result.outcome === 'customer_removed') {
    pending(op.kind !== 'customer_create' && result.customer_id === op.expected_customer_id);
    return result;
  }
  pending(['succeeded', 'failed'].includes(result.outcome));
  pending(op.kind === 'customer_create'
    ? (result.outcome === 'failed' ? result.customer_id === null : customerPattern.test(result.customer_id))
    : result.customer_id === op.expected_customer_id);
  if (result.outcome === 'succeeded' && op.kind !== 'customer_create') {
    pending(typeof result.data.id === 'string');
    if (result.data.url !== null) pending(usableUrl(result.data.url));
  }
  return result;
}
async function settleKnown(db: any, op: any, result: any, budget: Budget) {
  let receipt: any;
  try { receipt = await rpc(db, 'settle_billing_operation', { ...operationArgs(op), p_result: result }, budget); }
  catch {
    const saved = await rpc(db, 'read_billing_operation', { p_user_id: op.user_id, p_operation_id: op.operation_id }, budget);
    validateOperation(saved, op.user_id, op.provider_scope);
    pending(equal(operationArgs(saved), operationArgs(op)));
    if (saved.state === 'settled') receipt = { outcome: 'settled', operation_id: saved.operation_id,
      admitted_at: saved.admitted_at, result: saved.result };
    else receipt = await rpc(db, 'settle_billing_operation', { ...operationArgs(op), p_result: result }, budget);
  }
  pending(receipt?.outcome === 'settled' && receipt.operation_id === op.operation_id);
  const settled = validateResult(op, receipt.result);
  pending(equal(settled, result) || settled.outcome === 'customer_removed');
  return settled;
}
async function providerResult(op: any, value: any) {
  pending(object(value));
  const live = op.provider_scope.mode === 'live';
  if (op.kind === 'customer_create') {
    pending(value.object === 'customer' && customerPattern.test(value.id) && value.deleted !== true && value.livemode === live);
  } else {
    pending(value.object === (op.kind === 'checkout_create' ? 'checkout.session' : 'billing_portal.session')
      && typeof value.id === 'string' && value.customer === op.expected_customer_id && value.livemode === live);
    if (op.kind === 'checkout_create') pending(value.mode === 'subscription');
    pending(value.url === null || usableUrl(value.url));
  }
  if (op.kind !== 'portal_create') {
    pending(value.metadata?.survey_billing_operation_id === op.operation_id
      && value.metadata?.supabase_user_id === op.user_id
      && value.metadata?.survey_billing_spec === await billingSpecDigest(op.request_spec));
  }
  return { outcome: 'succeeded', customer_id: op.kind === 'customer_create' ? value.id : op.expected_customer_id,
    data: op.kind === 'customer_create' ? { id: value.id } : { id: value.id, url: value.url ?? null } };
}
export async function executeBillingOperation({ db, stripe, scope, userId, kind, customerId = null, spec,
  requestTimeoutMs = 15000, maxDurationMs = 45000 }: any) {
  assertScope(scope); pending(uuid.test(userId) && kinds.has(kind));
  const hash = await billingSpecDigest(spec), budget = budgetFor(requestTimeoutMs, maxDurationMs);
  const op: any = { operation_id: crypto.randomUUID(), user_id: userId, kind, provider_scope: scope,
    request_spec: spec, expected_customer_id: customerId };
  if (kind === 'customer_create') pending(customerId === null && typeof spec.email === 'string' && spec.email.length <= 320);
  else pending(customerPattern.test(customerId) && spec.customer === customerId);
  if (kind === 'checkout_create') pending(spec.mode === 'subscription' && !('customer_email' in spec) && !('customer_creation' in spec));
  const receipt = await rpc(db, 'begin_billing_operation', operationArgs(op), budget);
  pending(receipt?.operation_id === op.operation_id && receipt.outcome === 'admitted' && receipt.state === 'pending'
    && receipt.result === null && Number.isFinite(Date.parse(receipt.admitted_at)));
  op.admitted_at = receipt.admitted_at; op.state = 'pending';
  const metadata = { ...(spec.metadata || {}), supabase_user_id: userId,
    survey_billing_operation_id: op.operation_id, survey_billing_spec: hash };
  const params = kind === 'portal_create' ? spec : { ...spec, metadata };
  const options = { idempotencyKey: `survey-billing:${op.operation_id}`, maxNetworkRetries: 0 };
  let value: any;
  try {
    value = await timed(() => kind === 'customer_create' ? stripe.customers.create(params, options)
      : kind === 'checkout_create' ? stripe.checkout.sessions.create(params, options)
      : stripe.billingPortal.sessions.create(params, options), budget);
  } catch (error: any) {
    // Explicit parameter validation errors prove this creation was rejected.
    // Connection/API/idempotency/rate-limit errors remain unresolved.
    if (error?.type === 'StripeInvalidRequestError' && error.statusCode === 400
      && ['parameter_missing', 'parameter_unknown', 'parameter_invalid_integer', 'parameter_invalid_string', 'resource_missing', 'url_invalid'].includes(error.code)) {
      await settleKnown(db, op, { outcome: 'failed', customer_id: customerId, data: { code: error.code } }, budget);
    }
    throw new BillingPendingError();
  }
  const result = await settleKnown(db, op, await providerResult(op, value), budget);
  if (result.outcome === 'customer_removed') throw new BillingClosedError();
  return { operationId: op.operation_id, result };
}
async function recoverOne({ db, stripe, scope, userId }: any, op: any, budget: Budget) {
  validateOperation(op, userId, scope);
  if (op.customer_removed === true && op.kind !== 'customer_create') {
    await settleKnown(db, op, { outcome: 'customer_removed', customer_id: op.expected_customer_id, data: {} }, budget);
    return null;
  }
  let candidates: any[];
  let recentPortalEvent = false;
  let portalReuseUntil = 0;
  if (op.kind === 'customer_create') {
    const query = `metadata['survey_billing_operation_id']:'${op.operation_id}' AND metadata['supabase_user_id']:'${userId}'`;
    const found: any = await timed(() => stripe.customers.search({ query, limit: 2 }), budget);
    pending(Array.isArray(found?.data) && found.data.length <= 2 && typeof found.has_more === 'boolean');
    // Search absence and ambiguity are never completion proofs.
    if (found.has_more || found.data.length !== 1) return null;
    candidates = found.data;
  } else {
    const cursor = op.recovery_cursor ?? null;
    pending(cursor === null || (typeof cursor === 'string' && /^(?:cs|evt)_[A-Za-z0-9_]+$/.test(cursor)));
    const params = { limit: 100, ...(cursor ? { starting_after: cursor } : {}) };
    const page: any = await timed(() => op.kind === 'checkout_create'
      ? stripe.checkout.sessions.list({ ...params, customer: op.expected_customer_id })
      : stripe.events.list({ ...params, types: ['billing_portal.session.created'],
        created: { gte: Math.max(0, Math.floor(Date.parse(op.admitted_at) / 1000) - 5) } }), budget);
    pending(Array.isArray(page?.data) && page.data.length <= 100 && typeof page.has_more === 'boolean');
    if (op.kind === 'checkout_create') candidates = page.data.filter((item: any) => item.metadata?.survey_billing_operation_id === op.operation_id);
    else {
      const matches = page.data.filter((event: any) => event.type === 'billing_portal.session.created'
        && event.livemode === (scope.mode === 'live') && event.request?.idempotency_key === `survey-billing:${op.operation_id}`);
      const created = matches[0]?.created;
      recentPortalEvent = Number.isInteger(created) && created >= Date.now() / 1000 - 60 && created <= Date.now() / 1000 + 5;
      if (recentPortalEvent) portalReuseUntil = (created + 60) * 1000;
      candidates = matches.map((event: any) => event.data?.object);
    }
    if (candidates.length > 1) return null;
    if (!candidates.length) {
      const next = page.has_more ? page.data.at(-1)?.id : null;
      pending(next === null || typeof next === 'string');
      pending(!page.has_more || (next && next !== cursor));
      const changed = await rpc(db, 'advance_billing_operation_recovery_cursor', { p_user_id: userId,
        p_operation_id: op.operation_id, p_expected_cursor: cursor, p_next_cursor: next }, budget);
      pending(['advanced', 'stale', 'settled'].includes(changed?.outcome));
      return null;
    }
  }
  const result = await settleKnown(db, op, await providerResult(op, candidates[0]), budget);
  if (result.outcome !== 'succeeded') return null;
  if (op.kind === 'customer_create') return { operationId: op.operation_id, customerId: result.customer_id };
  const validUntil = op.kind === 'checkout_create'
    ? (Number.isInteger(candidates[0].expires_at) ? candidates[0].expires_at * 1000 : 0) : portalReuseUntil;
  return { kind: op.kind, requestSpec: op.request_spec, result, validUntil,
    reusable: validUntil > Date.now() && Boolean(result.data.url)
      && (op.kind === 'checkout_create' ? candidates[0].status === 'open' : recentPortalEvent) };
}
async function recoverWithBudget(options: any, budget: Budget) {
  const { db, scope, userId, maxPages = 2 } = options;
  assertScope(scope); pending(uuid.test(userId) && Number.isInteger(maxPages) && maxPages >= 1 && maxPages <= 3);
  const seen = new Set<string>(), recoveredCustomers: any[] = [], recoveredSessions: any[] = [];
  let errors = 0;
  for (let page = 0; page < maxPages; page++) {
    const scan = await rpc(db, 'scan_pending_billing_operations', { p_user_id: userId, p_limit: 20 }, budget);
    pending(Array.isArray(scan?.operations) && scan.operations.length <= 20);
    if (!scan.operations.length) break;
    let fresh = false;
    for (const op of scan.operations) {
      if (seen.has(op?.operation_id)) continue;
      fresh = true; seen.add(op?.operation_id);
      try {
        const recovered = await recoverOne(options, op, budget);
        if (recovered && 'customerId' in recovered) recoveredCustomers.push(recovered);
        else if (recovered?.reusable) recoveredSessions.push(recovered);
      }
      catch { errors++; } // Preserve unknown work; another candidate may be recoverable.
    }
    if (!fresh) break;
  }
  const state = await rpc(db, 'read_billing_account_closure', { p_user_id: userId }, budget);
  pending(typeof state?.has_pending_operations === 'boolean' && typeof state.closing === 'boolean');
  return { pending: state.has_pending_operations, closing: state.closing, recoveredCustomers, recoveredSessions, errors };
}
export function recoveredBillingSession(recovery: any, kind: string, spec: any) {
  return recovery.recoveredSessions?.find((entry: any) => entry.kind === kind && entry.validUntil > Date.now()
    && equal(entry.requestSpec, spec))?.result ?? null;
}
export async function recoverBillingOperations(options: any) {
  return recoverWithBudget(options, budgetFor(options.requestTimeoutMs, options.maxDurationMs));
}
async function rotateWithBudget({ db, scope, userId, expectedCustomerId, operationId = null }: any, budget: Budget) {
  assertScope(scope);
  const receipt = await rpc(db, 'rotate_billing_customer', { p_user_id: userId, p_provider_scope: scope,
    p_expected_customer_id: expectedCustomerId, p_customer_operation_id: operationId }, budget);
  pending(['applied', 'stale', 'closing'].includes(receipt?.outcome)
    && (receipt.customer_id === null || typeof receipt.customer_id === 'string'));
  if (receipt.outcome === 'closing') throw new BillingClosedError();
  return receipt.customer_id;
}
export async function rotateBillingCustomer(options: any) {
  return rotateWithBudget(options, budgetFor(options.requestTimeoutMs));
}
function liveCustomer(value: any, scope: any) {
  pending((value.deleted === undefined || value.deleted === false) && value.livemode === (scope.mode === 'live'));
  return value.id;
}
export async function verifyBoundBillingCustomer({ stripe, scope, customerId, requestTimeoutMs = 15000 }: any) {
  assertScope(scope); pending(customerPattern.test(customerId));
  let value: any;
  try { value = await timed(() => stripe.customers.retrieve(customerId), budgetFor(requestTimeoutMs)); }
  catch { throw new BillingPendingError(); }
  pending(value?.object === 'customer' && value.id === customerId);
  return liveCustomer(value, scope);
}
export async function reuseBillingCustomer({ db, stripe, scope, userId, requestTimeoutMs = 15000,
  maxDurationMs = 45000 }: any) {
  assertScope(scope); pending(uuid.test(userId));
  const budget = budgetFor(requestTimeoutMs, maxDurationMs);
  const saved = await rpc(db, 'read_reusable_billing_customer', { p_user_id: userId, p_provider_scope: scope }, budget);
  pending(object(saved) && ['none', 'bound', 'candidate', 'review', 'closing'].includes(saved.outcome)
    && (saved.customer_id === null || customerPattern.test(saved.customer_id)));
  if (saved.outcome === 'closing') throw new BillingClosedError();
  if (saved.outcome === 'review') throw new BillingPendingError('The saved billing customer needs review before starting new billing.');
  if (saved.outcome === 'none') {
    pending(saved.operation === null && saved.customer_id === null);
    return { customerId: null };
  }
  const retrieve = async (id: string) => {
    let value: any;
    try { value = await timed(() => stripe.customers.retrieve(id), budget); }
    catch { throw new BillingPendingError(); }
    pending(value?.object === 'customer' && value.id === id);
    return value;
  };
  if (saved.outcome === 'bound') {
    pending(saved.operation === null && customerPattern.test(saved.customer_id));
    return { customerId: liveCustomer(await retrieve(saved.customer_id), scope) };
  }
  pending(saved.customer_id === null);
  const op = validateOperation(saved.operation, userId, scope);
  pending(op.kind === 'customer_create' && op.state === 'settled' && op.customer_binding_state === 'available');
  const result = validateResult(op, op.result);
  pending(result.outcome === 'succeeded' && result.data.id === result.customer_id);
  const candidate = await retrieve(result.customer_id);
  if (candidate.deleted === true) {
    // An exact tombstone may retire this candidate, but a timeout or 404 cannot.
    // The SQL guard rejects retirement if another caller bound it meanwhile.
    const retired = await rpc(db, 'retire_reusable_billing_customer', { p_user_id: userId, p_provider_scope: scope,
      p_operation_id: op.operation_id, p_customer_id: result.customer_id }, budget);
    pending(object(retired) && ['retired', 'stale', 'closing'].includes(retired.outcome)
      && retired.customer_id === result.customer_id);
    if (retired.outcome === 'closing') throw new BillingClosedError();
    pending(retired.outcome === 'retired');
    return { customerId: null };
  }
  liveCustomer(candidate, scope);
  pending(equal(await providerResult(op, candidate), result));
  const bound = await rotateWithBudget({ db, scope, userId, expectedCustomerId: null, operationId: op.operation_id }, budget);
  pending(customerPattern.test(bound));
  // A competing caller may have won the binding CAS. Use only the authoritative
  // winner and verify its provider identity before starting checkout against it.
  return { customerId: bound === result.customer_id ? bound : liveCustomer(await retrieve(bound), scope) };
}
function deletedReceipt(value: any, customerId: string) {
  return value?.object === 'customer' && value.id === customerId && value.deleted === true;
}
function closureReceipt(value: any) {
  pending(object(value) && ['closing', 'has_pending_operations', 'has_pending_customers', 'current_customer_covered', 'complete']
    .every(key => typeof value[key] === 'boolean'));
  pending(!value.complete || (value.closing && !value.has_pending_operations && !value.has_pending_customers && value.current_customer_covered));
  return value;
}
export async function assertBillingClosureReady(db: any, userId: string, requestTimeoutMs = 15000) {
  const status = closureReceipt(await rpc(db, 'read_billing_account_closure', { p_user_id: userId }, budgetFor(requestTimeoutMs)));
  if (!status.complete) throw new BillingPendingError();
}
export async function cleanupAccountBilling({ db, stripe, scope, userId, requestTimeoutMs = 15000,
  maxDurationMs = 45000, maxClaims = 3 }: any) {
  assertScope(scope); pending(uuid.test(userId) && Number.isInteger(maxClaims) && maxClaims >= 1 && maxClaims <= 3);
  const budget = budgetFor(requestTimeoutMs, maxDurationMs);
  // Closure commits BEFORE any cancellation or recovery. This also stops new
  // core/Storage publication while cleanup is pending.
  const closure = closureReceipt(await rpc(db, 'begin_billing_account_closure', { p_user_id: userId, p_provider_scope: scope }, budget));
  pending(closure?.closing === true);
  let removed = 0;
  for (let claim = 0; claim < maxClaims; claim++) {
    const page = closureReceipt(await rpc(db, 'claim_billing_customer_cleanup', { p_user_id: userId, p_limit: 20 }, budget));
    pending(Array.isArray(page?.customers) && page.customers.length <= 20 && typeof page.complete === 'boolean');
    if (page.complete) { pending(page.customers.length === 0); return { complete: true, removed }; }
    if (!page.customers.length) break;
    for (const customer of page.customers) {
      // A wrong-mode/account/version or legacy platform record needs review.
      // Never acknowledge it through the currently configured provider.
      if (!equal(customer?.provider_scope, scope) || typeof customer.customer_id !== 'string') continue;
      const id = customer.customer_id;
      pending(id.length >= 1 && id.length <= 255 && !/[\u0000-\u001f\u007f]/.test(id));
      try {
        let receipt: any;
        try { receipt = await timed(() => stripe.customers.del(id), budget); }
        catch { receipt = await timed(() => stripe.customers.retrieve(id), budget); }
        if (!deletedReceipt(receipt, id)) continue;
        let ack = closureReceipt(await rpc(db, 'ack_billing_customer_cleanup', { p_user_id: userId, p_provider_scope: scope, p_customer_id: id }, budget));
        pending(typeof ack.has_pending_customer_operations === 'boolean');
        removed++;
        for (let drain = 0; ack?.has_pending_customer_operations === true && drain < 2; drain++) {
          ack = closureReceipt(await rpc(db, 'ack_billing_customer_cleanup', { p_user_id: userId, p_provider_scope: scope, p_customer_id: id }, budget));
          pending(typeof ack.has_pending_customer_operations === 'boolean');
        }
      } catch { /* Exact durable record remains pending for a later request. */ }
    }
  }
  // Positive recovery may reveal an unknown late customer; it must be cleaned
  // by a subsequent claim, not silently included in a successful response.
  try { await recoverWithBudget({ db, stripe, scope, userId, maxPages: 1 }, budget); } catch { /* pending */ }
  const final = closureReceipt(await rpc(db, 'read_billing_account_closure', { p_user_id: userId }, budget));
  return { complete: final.complete, removed };
}
