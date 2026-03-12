const MAX_LENGTH = 500;

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:(?:all|previous|prior|above|my|the|your|these)\s+)*(instructions?|prompts?|rules?)/i,
  /disregard\s+(?:(?:all|your|previous|prior|above|the|my|these)\s+)*(instructions?|prompts?|rules?)/i,
  /forget\s+(everything|all|your)/i,
  /do\s+not\s+follow\s+(your|the|any)/i,
  /override\s+(your|the|all|any)\s+(instructions?|prompts?|rules?)/i,
  /you\s+are\s+now\b/i,
  /\bact\s+as\s+(?:(?:a|an)\s+)?(database|system|admin|root|super|helpful|unrestricted|unfiltered)\b/i,
  /\bsystem\s+prompt\b/i,
  /\bjailbreak\b/i,
  /\b(?:you\s+are\s+DAN|enable\s+DAN|DAN\s+mode)\b/i,
  /```/,
  /\[INST\]/i,
  /<<SYS>>/i,
  /\bbase64\b/i,
  /\bdecode\s+(this|the|it)\s+(string|payload|text|base64|hex|code)\b/i,
  /\b0x[0-9A-Fa-f]{8,}\b/,
];

type ValidResult = { valid: true; question: string };
type InvalidResult = { valid: false };
type ValidationResult = ValidResult | InvalidResult;

export function validateInput(raw: string): ValidationResult {
  const question = raw.trim();

  if (question.length === 0 || question.length > MAX_LENGTH) {
    return { valid: false };
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(question)) {
      return { valid: false };
    }
  }

  return { valid: true, question };
}
