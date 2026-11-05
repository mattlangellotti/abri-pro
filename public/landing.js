// Demo landing: the preview window follows whichever seat is hovered or focused.
(() => {
  const data = JSON.parse(document.getElementById('seat-data').textContent);
  const caps = {
    full: (d) => `${d.who} sees ${d.pages.length} of 9 pages and approves what goes out. Only the marketing lead manages people.`,
    admin: (d) => `${d.who} sees all 9 pages, including who gets access to what.`,
    team: (d) => `${d.who} sees ${d.pages.length} pages. Her posts wait for an owner to approve them.`,
    overview: (d) => `${d.who} sees ${d.pages.length} pages: ${d.pages.slice(0, -1).join(', ')} and ${d.pages[d.pages.length - 1]}.`
  };
  const win = document.getElementById('win');
  const who = document.getElementById('win-who');
  const act = document.getElementById('win-act');
  const cap = document.getElementById('peek-cap');
  const tabs = [...document.querySelectorAll('.wt')];
  const seats = [...document.querySelectorAll('.seat')];
  let current = null;
  function show(role) {
    if (role === current || !data[role]) return;
    current = role;
    const d = data[role];
    seats.forEach((s) => s.classList.toggle('is-on', s.dataset.seat === role));
    tabs.forEach((t) => t.classList.toggle('off', !d.pages.includes(t.dataset.tab)));
    win.dataset.seat = role;
    who.textContent = d.who;
    act.textContent = d.action;
    cap.textContent = caps[role](d);
  }
  seats.forEach((s) => {
    s.addEventListener('mouseenter', () => show(s.dataset.seat));
    s.addEventListener('focus', () => show(s.dataset.seat));
  });
  show('full');
})();
