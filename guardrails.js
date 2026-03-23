export const EAP_RESOURCE_LINK = "https://www.samhsa.gov/find-help/national-helpline";

export function checkGuardrails(input, output) {
  const distressSignals = [
    "i can't cope",
    "i give up",
    "i don't want to work anymore",
    "i'm falling apart",
    "i need help",
  ];

  const clinicalLanguage = [
    "diagnosed",
    "disorder",
    "depressed",
    "anxiety disorder",
    "mentally ill",
    "burnout diagnosis",
  ];

  const normalizedInput = String(input || "").toLowerCase();
  const normalizedOutput = String(output || "").toLowerCase();
  const distressMatch = distressSignals.find((phrase) => normalizedInput.includes(phrase));
  const clinicalMatch = clinicalLanguage.find((phrase) => normalizedOutput.includes(phrase));

  if (distressMatch || clinicalMatch) {
    return {
      blocked: true,
      reason: distressMatch ? "distress_signal" : "clinical_language",
      safeMessage: distressMatch
        ? "I'm sorry you're carrying so much right now. You deserve support from a person who can help in real time, so please reach out to your manager, your Employee Assistance Program, or a trusted professional."
        : "I want to keep this supportive and avoid clinical framing. Please consider reaching out to your Employee Assistance Program, your manager, or a licensed professional for more direct support.",
      eapLink: EAP_RESOURCE_LINK,
      output: null,
    };
  }

  return {
    blocked: false,
    reason: null,
    safeMessage: null,
    eapLink: null,
    output,
  };
}
