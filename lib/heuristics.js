// Usability heuristics used to tag feedback. Manual comments can be tagged with
// one; Phase 2's automated audit will emit findings against the same ids.
(function (g) {
  g.FoxioHeuristics = [
    { id: 'h1', short: 'System status', name: 'Visibility of system status',
      desc: 'Keep users informed about what is going on through timely, appropriate feedback.' },
    { id: 'h2', short: 'Real-world match', name: 'Match between system and the real world',
      desc: 'Speak the users’ language, with familiar words, concepts and conventions.' },
    { id: 'h3', short: 'User control', name: 'User control and freedom',
      desc: 'Provide clearly marked exits, undo and redo.' },
    { id: 'h4', short: 'Consistency', name: 'Consistency and standards',
      desc: 'Follow platform and industry conventions; the same thing should look and behave the same.' },
    { id: 'h5', short: 'Error prevention', name: 'Error prevention',
      desc: 'Eliminate error-prone conditions or confirm before risky actions.' },
    { id: 'h6', short: 'Recognition', name: 'Recognition rather than recall',
      desc: 'Make elements, actions and options visible so users don’t have to remember them.' },
    { id: 'h7', short: 'Efficiency', name: 'Flexibility and efficiency of use',
      desc: 'Shortcuts and accelerators for experts without confusing novices.' },
    { id: 'h8', short: 'Minimalist design', name: 'Aesthetic and minimalist design',
      desc: 'Remove irrelevant or rarely needed information that competes for attention.' },
    { id: 'h9', short: 'Error recovery', name: 'Help users recognize, diagnose and recover from errors',
      desc: 'Error messages in plain language that say what went wrong and how to fix it.' },
    { id: 'h10', short: 'Help & docs', name: 'Help and documentation',
      desc: 'Provide easy-to-search help focused on the user’s task.' },
    { id: 'a11y', short: 'Accessibility', name: 'Accessibility',
      desc: 'Contrast, labels, keyboard access, target sizes and screen-reader support (WCAG).' }
  ];
})(globalThis);
