const menuButton = document.querySelector('[data-menu-button]');
const menu = document.querySelector('[data-menu]');
const menuParent = menu?.parentNode;
const header = document.querySelector('[data-header]');
const pageRegions = [document.querySelector('main'), document.querySelector('footer')].filter(Boolean);
let menuReturnFocus = null;
let menuScrollY = 0;

function setPageInert(isInert) {
  pageRegions.forEach(region => {
    if (isInert) region.setAttribute('inert', '');
    else region.removeAttribute('inert');
  });
}

function closeMenu({ restoreFocus = false, restoreScroll = true } = {}) {
  if (!menuButton || !menu) return;
  const wasOpen = menuButton.getAttribute('aria-expanded') === 'true';
  if (!wasOpen) return;
  const scrollYToRestore = menuScrollY;
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.querySelector('.sr-only').textContent = 'Open navigation';
  menu.classList.remove('is-open');
  document.body.classList.remove('menu-open');
  document.body.style.top = '';
  setPageInert(false);
  if (restoreFocus) menuReturnFocus?.focus({ preventScroll: true });
  menuReturnFocus = null;
  menuScrollY = 0;
  if (restoreScroll) requestAnimationFrame(() => {
    const previousScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, scrollYToRestore);
    document.documentElement.style.scrollBehavior = previousScrollBehavior;
  });
}

function openMenu() {
  if (!menuButton || !menu) return;
  menuScrollY = window.scrollY;
  menuReturnFocus = document.activeElement;
  document.body.append(menu);
  menuButton.setAttribute('aria-expanded', 'true');
  menuButton.querySelector('.sr-only').textContent = 'Close navigation';
  menu.classList.add('is-open');
  document.body.style.top = `-${menuScrollY}px`;
  document.body.classList.add('menu-open');
  setPageInert(true);
  const reattachMenu = () => menuParent?.append(menu);
  requestAnimationFrame(reattachMenu);
  queueMicrotask(() => requestAnimationFrame(reattachMenu));
}

if (menuButton && menu) {
  menuButton.addEventListener('click', () => {
    const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
    if (isOpen) closeMenu({ restoreFocus: true });
    else openMenu();
  });

  menu.addEventListener('click', event => {
    if (event.target.closest('a')) closeMenu({ restoreScroll: false });
  });

  document.addEventListener('keydown', event => {
    if (menuButton.getAttribute('aria-expanded') !== 'true') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [menuButton, ...menu.querySelectorAll('a')];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!focusable.includes(document.activeElement)) {
      event.preventDefault();
      first.focus();
      requestAnimationFrame(() => menuParent?.append(menu));
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

window.addEventListener('resize', () => {
  if (window.innerWidth > 760) closeMenu();
});

window.addEventListener('scroll', () => {
  header?.classList.toggle('scrolled', window.scrollY > 12);
}, { passive: true });

document.querySelectorAll('.skip-link').forEach(link => {
  link.addEventListener('click', () => {
    const target = document.querySelector(link.hash);
    requestAnimationFrame(() => target?.focus({ preventScroll: true }));
  });
});

document.querySelectorAll('[data-year]').forEach(element => {
  element.textContent = String(new Date().getFullYear());
});

document.querySelectorAll('[data-screen-carousel]').forEach(carousel => {
  const screens = [...carousel.querySelectorAll('.carousel-screen')];
  const label = carousel.querySelector('[data-screen-label]');
  const description = carousel.querySelector('.carousel-caption [data-screen-description]');
  const count = carousel.querySelector('[data-screen-count]');
  const previous = carousel.querySelector('[data-screen-previous]');
  const next = carousel.querySelector('[data-screen-next]');
  const dots = carousel.querySelector('[data-screen-dots]');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let activeIndex = 0;
  let timer;

  const dotButtons = screens.map((screen, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', `Show ${screen.dataset.screenTitle}`);
    button.addEventListener('click', () => {
      showScreen(index);
      restart();
    });
    dots?.append(button);
    return button;
  });

  function showScreen(index) {
    activeIndex = (index + screens.length) % screens.length;
    screens.forEach((screen, screenIndex) => {
      const isActive = screenIndex === activeIndex;
      screen.classList.toggle('is-active', isActive);
      screen.setAttribute('aria-hidden', String(!isActive));
    });
    dotButtons.forEach((button, dotIndex) => {
      button.setAttribute('aria-current', String(dotIndex === activeIndex));
    });
    if (label) label.textContent = screens[activeIndex]?.dataset.screenTitle ?? '';
    if (description) description.textContent = screens[activeIndex]?.dataset.screenDescription ?? '';
    if (count) count.textContent = `${activeIndex + 1} of ${screens.length}`;
  }

  function stop() {
    window.clearInterval(timer);
    timer = undefined;
  }

  function start() {
    if (carousel.dataset.screenAutoplay === 'false' || reduceMotion.matches || document.hidden || timer) return;
    timer = window.setInterval(() => showScreen(activeIndex + 1), 4500);
  }

  function restart() {
    stop();
    start();
  }

  previous?.addEventListener('click', () => {
    showScreen(activeIndex - 1);
    restart();
  });
  next?.addEventListener('click', () => {
    showScreen(activeIndex + 1);
    restart();
  });
  carousel.addEventListener('pointerenter', stop);
  carousel.addEventListener('pointerleave', start);
  carousel.addEventListener('focusin', stop);
  carousel.addEventListener('focusout', event => {
    if (!carousel.contains(event.relatedTarget)) start();
  });
  reduceMotion.addEventListener('change', restart);
  document.addEventListener('visibilitychange', restart);
  showScreen(0);
  start();
});

const betaForm = document.querySelector('[data-beta-form]');

if (betaForm) {
  const submit = betaForm.querySelector('[data-beta-submit]');
  const submitLabel = betaForm.querySelector('[data-beta-submit-label]');
  const status = betaForm.querySelector('[data-beta-status]');
  const success = betaForm.querySelector('[data-beta-success]');

  function setBetaState(state, message = '') {
    betaForm.classList.toggle('beta-form--loading', state === 'loading');
    betaForm.classList.toggle('beta-form--error', state === 'error');
    betaForm.classList.toggle('beta-form--success', state === 'success');
    if (submit) submit.disabled = state === 'loading';
    if (submitLabel) submitLabel.textContent = state === 'loading' ? 'Joining…' : 'Request an invite';
    if (status) status.textContent = message;
    if (success) success.hidden = state !== 'success';
    if (state === 'success') success?.focus({ preventScroll: true });
  }

  const state = new URLSearchParams(window.location.search);
  if (state.get('joined') === '1') setBetaState('success');
  else if (state.get('error') === '1') {
    setBetaState('error', 'We could not submit your request. Please check both fields and try again.');
  }

  betaForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!betaForm.reportValidity()) return;
    setBetaState('loading', 'Submitting your request…');
    const formData = new FormData(betaForm);
    const body = {
      name: formData.get('name'),
      email: formData.get('email'),
      website: formData.get('website'),
    };
    try {
      const response = await fetch(betaForm.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const message = response.status === 429
          ? 'Please wait a little before trying again.'
          : 'Check your name and email, then try again.';
        setBetaState('error', message);
        return;
      }
      betaForm.reset();
      window.location.assign('/beta/thanks/');
    } catch {
      setBetaState('error', 'We could not connect right now. Please try again in a moment.');
    }
  });
}
