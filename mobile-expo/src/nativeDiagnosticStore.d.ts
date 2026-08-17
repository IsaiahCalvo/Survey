export interface NativeDiagnosticState {
  diagnostics: Array<Record<string, unknown>>;
  pendingEvents: Array<Record<string, unknown>>;
  recoveries: number[];
}

export function loadNativeDiagnosticState(storage: {
  getItem(key: string): Promise<string | null>;
}): Promise<NativeDiagnosticState>;

export function saveNativeDiagnosticState(storage: {
  setItem(key: string, value: string): Promise<void>;
}, state: NativeDiagnosticState): Promise<NativeDiagnosticState>;

export function acknowledgeNativeAnalyticsEvents(
  pendingEvents: Array<Record<string, unknown>>,
  acknowledgedIds: unknown[],
): Array<Record<string, unknown>>;

export function claimNativeAnalyticsEvents(
  pendingEvents: Array<Record<string, unknown>>,
  inFlightIds: Set<string>,
): Array<Record<string, unknown>>;

export function mergeNativeDiagnosticStates(
  stored: Partial<NativeDiagnosticState>,
  live: Partial<NativeDiagnosticState>,
): NativeDiagnosticState;

export function createNativeDiagnosticPersistenceGate(storage: {
  setItem(key: string, value: string): Promise<void>;
}): {
  persist(stateProvider: () => Partial<NativeDiagnosticState>): Promise<unknown>;
  markHydrated(): Promise<unknown>;
  flush(): Promise<unknown>;
};
