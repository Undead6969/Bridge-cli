function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/$/, "");
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export function originAllowed(origin: string | undefined): boolean {
  if (!origin) {
    return true;
  }

  const configured = process.env.BRIDGE_ALLOWED_ORIGINS?.trim();
  if (!configured || configured === "*") {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  const patterns = configured
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return patterns.some((pattern) => {
    const normalizedPattern = normalizeOrigin(pattern);
    if (normalizedPattern === normalizedOrigin) {
      return true;
    }
    if (normalizedPattern.includes("*")) {
      return wildcardToRegExp(normalizedPattern).test(normalizedOrigin);
    }
    return false;
  });
}
