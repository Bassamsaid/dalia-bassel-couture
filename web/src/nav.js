/* Who sees what, copied across unchanged from the app in service. As screens
   are ported, each one is added here; until then the old app answers for it,
   which is what `legacy` marks. */
export const NAV = {
  admin: [
    ['home', 'Home', '⌂', { legacy: true }],
    ['mycheck', 'Check in / out', '🕒'],
    ['members', 'Members', '👥', { legacy: true }],
    ['academy', 'Academy', '🎓', { legacy: true }],
    ['classroom', 'Classroom', '📚', { legacy: true }],
    ['dalia', 'Dalia', '✦', { legacy: true }],
    ['dresses', 'Dresses', '👗', { legacy: true }],
    ['collections', 'Collections', '💵', { legacy: true }],
    ['spending', 'Spending', '💸', { legacy: true }],
    ['staff', 'Staff', '💼', { legacy: true }],
    ['attreqs', 'Attendance requests', '🕒', { legacy: true }],
    ['config', 'Configuration', '⚙', { legacy: true }],
    ['about', 'About', 'ℹ', { legacy: true }],
  ],
  manager: [
    ['home', 'Attendance', '🕒', { legacy: true }],
    ['dresses', 'Dresses', '👗', { legacy: true }],
    ['academy', 'Academy', '🎓', { legacy: true }],
    ['spending', 'Spending', '💸', { legacy: true }],
    ['me', 'My record', '🧾', { legacy: true }],
    ['dalia', 'Dalia Bassel', '✦', { legacy: true }],
    ['about', 'About', 'ℹ', { legacy: true }],
  ],
  staff: [
    ['home', 'Attendance', '🕒', { legacy: true }],
    ['dresses', 'Dresses', '👗', { legacy: true }],
    ['academy', 'Academy', '🎓', { legacy: true }],
    ['me', 'My record', '🧾', { legacy: true }],
    ['dalia', 'Dalia Bassel', '✦', { legacy: true }],
    ['about', 'About', 'ℹ', { legacy: true }],
  ],
};

export const BOTTOM = {
  admin: [['home', 'Home', '⌂'], ['dresses', 'Dresses', '👗'], ['collections', 'Collections', '💵'], ['academy', 'Academy', '🎓'], ['dalia', 'Dalia', '✦']],
  manager: [['home', 'Attendance', '🕒'], ['dresses', 'Dresses', '👗'], ['academy', 'Academy', '🎓'], ['dalia', 'Dalia', '✦']],
};

/* A screen not written here yet is answered by the app in service, at its own
   address. Nobody is left in front of a page that does not exist. */
export const legacyUrl = (page) => '/?page=' + encodeURIComponent(page);
