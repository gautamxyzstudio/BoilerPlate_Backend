export const normalizeIdentifier = (identifier: string) => {
  const value = identifier.trim();

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const phoneRegex = /^[6-9]\d{9}$/;

  if (emailRegex.test(value)) {
    return {
      identifier: value.toLowerCase(),
      identifierType: "email" as const,
    };
  }

  if (phoneRegex.test(value)) {
    return {
      identifier: `+91${value}`,
      identifierType: "phone" as const,
    };
  }

  return null;
};