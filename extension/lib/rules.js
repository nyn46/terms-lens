// Known-pattern rules used by Quick Scan. Each rule is deterministic and local.
export const RULES = [
  {
    pattern: /binding arbitration|mandatory arbitration|resolve.*arbitration/i,
    classification: "concern",
    severity: "high",
    category: "Disputes",
    title: "Mandatory arbitration",
    plainEnglish: "Disputes may have to be handled privately through arbitration instead of court.",
    whyItMatters: "This can limit how and where you bring a claim.",
    suggestedAction: "Check whether the document provides an arbitration opt-out window."
  },
  {
    pattern: /class action waiver|waive.*class action|individual capacity only/i,
    classification: "concern",
    severity: "high",
    category: "Disputes",
    title: "Class actions waived",
    plainEnglish: "You may be giving up the ability to join a class or collective claim.",
    whyItMatters: "Small claims can be difficult to pursue individually.",
    suggestedAction: "Look for an opt-out process and deadline."
  },
  {
    pattern: /automatically renew|auto-renew|automatic renewal|recurring subscription/i,
    classification: "caution",
    severity: "medium",
    category: "Payments",
    title: "Automatic renewal",
    plainEnglish: "The subscription may renew and charge you unless you cancel.",
    whyItMatters: "You could pay for another term without taking a new action.",
    suggestedAction: "Check the renewal date and cancellation deadline."
  },
  {
    pattern: /non-refundable|no refunds|all (?:fees|payments) are final/i,
    classification: "concern",
    severity: "medium",
    category: "Refunds",
    title: "Refunds restricted",
    plainEnglish: "Some or all payments may not be refundable.",
    whyItMatters: "You may not recover money if you stop using the service or are dissatisfied.",
    suggestedAction: "Review exceptions and local consumer rights before paying."
  },
  {
    pattern: /perpetual.{0,80}(?:license|licence)|irrevocable.{0,80}(?:license|licence)/i,
    classification: "concern",
    severity: "high",
    category: "Your content",
    title: "Long-lasting content licence",
    plainEnglish: "The service may retain broad rights to use content you upload.",
    whyItMatters: "Those rights may continue even if you stop using the service.",
    suggestedAction: "Check whether deleting content or your account ends the licence."
  },
  {
    pattern: /sell (?:your |the )?personal (?:data|information)|sale of personal (?:data|information)/i,
    skipPattern: /\b(?:do not|don't|will not|won't|never|not)\s+sell\b/i,
    classification: "concern",
    severity: "high",
    category: "Privacy",
    title: "Personal data may be sold",
    plainEnglish: "The policy discusses selling personal information.",
    whyItMatters: "Your data may be transferred for commercial benefit beyond providing the service.",
    suggestedAction: "Look for a Do Not Sell or opt-out control."
  },
  {
    pattern: /may (?:change|modify|update).{0,100}(?:terms|agreement).{0,100}(?:at any time|without notice)/i,
    classification: "caution",
    severity: "medium",
    category: "Changes",
    title: "Terms may change",
    plainEnglish: "The company may change the agreement with limited notice.",
    whyItMatters: "Your rights or obligations could change after you sign up.",
    suggestedAction: "Check how changes are announced and when they take effect."
  },
  {
    pattern: /delete your (?:account|personal data)|right to (?:delete|erasure)|request deletion/i,
    classification: "positive",
    severity: "low",
    category: "Privacy",
    title: "Deletion right described",
    plainEnglish: "The document describes a way to request deletion of your account or data.",
    whyItMatters: "This gives you more control when you leave the service.",
    suggestedAction: "Note the deletion method and any stated exceptions."
  },
  {
    pattern: /(?:30|thirty) days.{0,80}(?:notice|advance)|advance notice.{0,80}(?:price|change)/i,
    classification: "positive",
    severity: "low",
    category: "Changes",
    title: "Advance notice promised",
    plainEnglish: "The company promises advance notice for certain changes.",
    whyItMatters: "You get time to review the change or cancel before it applies.",
    suggestedAction: null
  },
  {
    pattern: /cancel at any time|may cancel your subscription at any time/i,
    classification: "positive",
    severity: "low",
    category: "Cancellation",
    title: "Cancellation is available",
    plainEnglish: "The document says you can cancel at any time.",
    whyItMatters: "You are not locked into continuing indefinitely, though billing cutoffs may still apply.",
    suggestedAction: "Confirm where cancellation is completed and when charges stop."
  }
];
