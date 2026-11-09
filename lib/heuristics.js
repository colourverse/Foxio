// Usability heuristics used to tag feedback, and the content of the
// Heuristics guide (heuristics/heuristics.html). Manual comments can be tagged
// with one; the automated audit emits findings against the same ids.
//
// Fields: id, num (badge), short (chip label), name, desc (one-line summary,
// used as in-app hints), why, lookFor[], doThis[], example {good, bad}, refs[].
(function (g) {
  const NNG = { label: 'Jakob Nielsen, 10 Usability Heuristics for User Interface Design (Nielsen Norman Group)', url: 'https://www.nngroup.com/articles/ten-usability-heuristics/' };

  g.FoxioHeuristics = [
    {
      id: 'h1', num: '1', short: 'System status', name: 'Visibility of system status',
      desc: 'Keep users informed about what is going on through timely, appropriate feedback.',
      why: 'People decide what to do next based on what they believe the system is doing. Without feedback they repeat actions, give up, or stop trusting the product.',
      lookFor: [
        'Buttons that show no response when clicked',
        'Long operations with no progress indicator',
        'No confirmation after saving, sending or submitting',
        'Navigation with no “you are here” state',
        'Data that may be stale with no “last updated” time'
      ],
      doThis: [
        'Acknowledge every action immediately (pressed state, spinner)',
        'Show progress for anything over about a second; show percent or steps for long tasks',
        'Highlight the current page, tab or step',
        'Confirm completion where the user is looking'
      ],
      example: {
        good: 'A document title shows “Saving…” and then “Saved just now”.',
        bad: 'A Submit button does nothing visible for four seconds, so the user clicks it three times.'
      },
      refs: [NNG]
    },
    {
      id: 'h2', num: '2', short: 'Real-world match', name: 'Match between system and the real world',
      desc: 'Speak the users’ language, with familiar words, concepts and conventions.',
      why: 'Users bring vocabulary and mental models from the rest of their lives. Internal jargon or unfamiliar ordering forces them to translate, which slows them down and causes mistakes.',
      lookFor: [
        'Internal or technical terms (“entity”, “SKU”, “Error 0x80”)',
        'Icons without a widely understood meaning',
        'Information in an order that doesn’t match the real task',
        'Vague link text like “Read more” or “Click here”'
      ],
      doThis: [
        'Use the words customers use (check search terms and support tickets)',
        'Order steps and fields the way the task happens in real life',
        'Label links by where they go',
        'Pair unfamiliar icons with a text label'
      ],
      example: {
        good: '“Delivery address”',
        bad: '“Shipping entity location”'
      },
      refs: [NNG]
    },
    {
      id: 'h3', num: '3', short: 'User control', name: 'User control and freedom',
      desc: 'Provide clearly marked exits, undo and redo.',
      why: 'People make mistakes and like to explore. A clear way out lets them try things without fear of getting stuck or losing work.',
      lookFor: [
        'Dialogs with no close button, Cancel or Esc',
        'No undo after deleting or archiving',
        'Multi-step flows where going back loses what was entered',
        'Forced flows that can’t be skipped (onboarding, tours)',
        'Media or carousels that auto-play with no pause'
      ],
      doThis: [
        'Offer Cancel and Back throughout',
        'For reversible actions, prefer Undo over a confirmation dialog',
        'Keep entered data when users navigate back',
        'Let users dismiss, pause and skip'
      ],
      example: {
        good: '“Conversation archived. Undo”',
        bad: 'A delete that happens instantly with no way to get the item back.'
      },
      refs: [NNG]
    },
    {
      id: 'h4', num: '4', short: 'Consistency', name: 'Consistency and standards',
      desc: 'Follow platform and industry conventions; the same thing should look and behave the same.',
      why: 'Users spend most of their time on other sites and apps (Jakob’s law). Breaking conventions, or being inconsistent with yourself, makes people relearn things they already know.',
      lookFor: [
        'The same action with different labels (“Save”, “Submit”, “Done”)',
        'Several different styles for primary buttons',
        'Links that look like plain text, or text that looks like a link',
        'Heading levels chosen for size rather than structure',
        'Familiar conventions ignored (logo not linking home, cart not top-right)'
      ],
      doThis: [
        'Build from a shared set of components and styles',
        'Use one word for one concept, everywhere',
        'Follow platform conventions unless there is a strong reason not to'
      ],
      example: {
        good: 'Every primary action uses the same filled orange button.',
        bad: 'The checkout uses a green “Proceed” button and the cart uses a blue “Continue” link for the same step.'
      },
      refs: [NNG]
    },
    {
      id: 'h5', num: '5', short: 'Error prevention', name: 'Error prevention',
      desc: 'Eliminate error-prone conditions or confirm before risky actions.',
      why: 'A good error message is helpful, but a design that prevents the error is better. Errors come from slips (inattention) and mistakes (a wrong idea of how it works).',
      lookFor: [
        'Destructive actions next to common ones, styled the same',
        'Free-text fields where a picker or fixed choice would work (dates, countries)',
        'Rules revealed only after submitting (password requirements)',
        'Irreversible, costly actions with no confirmation',
        'Defaults that are easy to accept by accident'
      ],
      doThis: [
        'Constrain input with the right control and input type',
        'Show requirements up front and check fields as people go',
        'Confirm only irreversible, costly actions, and name the consequence',
        'Set safe defaults; keep destructive actions visually and physically separate'
      ],
      example: {
        good: '“Delete project ‘Website 2026’ and its 48 files? This can’t be undone.” [Cancel] [Delete project]',
        bad: '“Are you sure?” [OK] [Cancel]'
      },
      refs: [NNG]
    },
    {
      id: 'h6', num: '6', short: 'Recognition', name: 'Recognition rather than recall',
      desc: 'Make elements, actions and options visible so users don’t have to remember them.',
      why: 'Short-term memory is limited. Recognising an option on screen is much easier than recalling it from memory.',
      lookFor: [
        'Placeholder text used as the only label',
        'Icon-only controls with no text',
        'Instructions shown once and then hidden',
        'Having to copy a code or value from another screen',
        'No recent items, history or suggestions'
      ],
      doThis: [
        'Keep labels visible at all times',
        'Offer recent items, suggestions and autocomplete',
        'Keep important context on screen (e.g. the order summary during checkout)',
        'Label icons, at least on first use'
      ],
      example: {
        good: 'A search box that shows your recent searches when focused.',
        bad: 'A form whose field names disappear as soon as you start typing.'
      },
      refs: [NNG]
    },
    {
      id: 'h7', num: '7', short: 'Efficiency', name: 'Flexibility and efficiency of use',
      desc: 'Shortcuts and accelerators for experts without confusing novices.',
      why: 'Newcomers need guidance; frequent users need speed. Accelerators that newcomers can ignore serve both groups.',
      lookFor: [
        'No keyboard shortcuts for frequent actions in tools',
        'No bulk actions for repetitive work',
        'Asking for the same information more than once',
        'Small, hard-to-hit targets (Fitts’s law)',
        'Large amounts of content with no search or filters'
      ],
      doThis: [
        'Add shortcuts, bulk edit, templates and saved preferences',
        'Support browser autofill with correct autocomplete attributes',
        'Provide search and filters for large collections',
        'Make frequently used targets large and close at hand'
      ],
      example: {
        good: 'Select several rows, then press Delete or choose a bulk action.',
        bad: 'Archiving 40 items means opening each one and clicking Archive.'
      },
      refs: [NNG]
    },
    {
      id: 'h8', num: '8', short: 'Minimalist design', name: 'Aesthetic and minimalist design',
      desc: 'Remove irrelevant or rarely needed information that competes for attention.',
      why: 'Every extra element competes with the ones that matter and lowers their visibility. This is about focus and signal-to-noise, not about a flat or sparse visual style.',
      lookFor: [
        'No clear primary action, or several competing ones of equal weight',
        'Long menus and crowded navigation',
        'Walls of text, very small text, or very long lines',
        'Decoration that looks clickable',
        'Promotions and clutter around the core task'
      ],
      doThis: [
        'Give each view one obvious primary action',
        'Build hierarchy with size, contrast and spacing',
        'Reveal advanced options only when needed (progressive disclosure)',
        'Cut copy hard; keep lines to about 50–75 characters'
      ],
      example: {
        good: 'A pricing page where one plan and one button stand out.',
        bad: 'Five equally loud buttons above the fold, each a different colour.'
      },
      refs: [NNG]
    },
    {
      id: 'h9', num: '9', short: 'Error recovery', name: 'Help users recognize, diagnose and recover from errors',
      desc: 'Error messages in plain language that say what went wrong and how to fix it.',
      why: 'When something goes wrong, the error message becomes the interface. It should explain the problem in plain language and offer a way forward.',
      lookFor: [
        'Codes or generic text (“Invalid input”, “Error 500”)',
        'Errors shown far from the field, or only at the top of the page',
        'Forms cleared after an error',
        'Errors indicated by colour alone',
        'Wording that blames the user'
      ],
      doThis: [
        'Show the message next to the problem',
        'Say what happened and exactly how to fix it',
        'Keep everything the user entered',
        'Use text and an icon, not colour alone; offer retry or contact options'
      ],
      example: {
        good: '“This card number has 15 digits. Visa cards have 16. Check the number on the front of your card.”',
        bad: '“Invalid payment details.”'
      },
      refs: [NNG]
    },
    {
      id: 'h10', num: '10', short: 'Help & docs', name: 'Help and documentation',
      desc: 'Provide easy-to-search help focused on the user’s task.',
      why: 'Ideally nothing needs explaining, but some tasks are complex. When help is needed it should be easy to find, focused on the task, and available in context.',
      lookFor: [
        'No help or contact link',
        'Help only as one long FAQ page',
        'Documentation full of jargon',
        'Empty states with no guidance on what to do',
        'No way to reach a person'
      ],
      doThis: [
        'Put short help next to complex fields',
        'Write searchable, task-based docs with concrete steps',
        'Use empty states to explain the next step',
        'Make it easy to contact a human'
      ],
      example: {
        good: 'An empty project list that says “No projects yet” with a “Create your first project” button and a link to a 2-minute guide.',
        bad: 'An empty white page.'
      },
      refs: [NNG]
    },
    {
      id: 'a11y', num: 'A', short: 'Accessibility', name: 'Accessibility',
      desc: 'Contrast, labels, keyboard access, target sizes and screen-reader support (WCAG).',
      why: 'Around 1 in 6 people has a significant disability (WHO), and many more face temporary or situational limits: bright sunlight, one hand busy, a slow connection. Accessible design works better for everyone and is a legal requirement in many places.',
      lookFor: [
        'Text contrast below 4.5:1 (3:1 for large text and UI parts)',
        'Images without alt text; buttons and links without names',
        'Form fields without labels',
        'Things that can’t be reached or used with the keyboard; invisible focus',
        'Targets smaller than 24×24px; pinch-zoom disabled; no page language'
      ],
      doThis: [
        'Aim for WCAG 2.2 level AA',
        'Test with only the keyboard, and with a screen reader',
        'Use semantic HTML first and ARIA only where needed',
        'Never rely on colour alone; respect reduced-motion settings'
      ],
      example: {
        good: 'An icon-only close button with aria-label="Close dialog" and a visible focus ring.',
        bad: 'Light grey text on white, and a close “×” that keyboard users can’t reach.'
      },
      refs: [
        { label: 'W3C, Web Content Accessibility Guidelines (WCAG) 2.2', url: 'https://www.w3.org/TR/WCAG22/' },
        { label: 'W3C, How to Meet WCAG (quick reference)', url: 'https://www.w3.org/WAI/WCAG22/quickref/' }
      ]
    }
  ];
})(globalThis);
