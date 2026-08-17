export function resolveBrevoApiKey(value: string | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}
