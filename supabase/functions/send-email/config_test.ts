import { assertEquals } from 'jsr:@std/assert@1.0.18';
import { resolveBrevoApiKey } from './config.ts';

Deno.test('Brevo configuration fails closed for missing or blank keys', () => {
    assertEquals(resolveBrevoApiKey(undefined), null);
    assertEquals(resolveBrevoApiKey('   '), null);
});

Deno.test('Brevo configuration returns a trimmed non-empty key', () => {
    assertEquals(resolveBrevoApiKey('  test-key  '), 'test-key');
});
