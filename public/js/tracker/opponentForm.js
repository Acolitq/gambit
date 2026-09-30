import { api } from '../net/api.js';
import { refreshIcons } from '../router.js';
import { escapeHtml } from './util.js';

// Add / edit an opponent. Typing a name searches CFC + FIDE so the player can be
// linked in one click (that link is what pulls in ratings and the OTB game log);
// Chess.com / Lichess handles pull in their online games.
//
// renderOpponentForm(el, { initial, title, submitLabel, onSubmit, onCancel, onDelete })
// onSubmit receives { name, chesscom, lichess, cfcId, fideId, rating }.
export function renderOpponentForm(el, { initial = {}, title, submitLabel, onSubmit, onCancel, onDelete }) {
  const state = {
    cfcId: initial.cfc_id || '',
    fideId: initial.fide_id || '',
    rating: initial.rating || null,
    linkedLabel: initial.cfc_id || initial.fide_id ? linkLabel(initial) : '',
  };

  el.innerHTML = `
    <form class="of card" novalidate>
      <div class="of-head">
        <h2 class="of-title">${escapeHtml(title)}</h2>
        ${onCancel ? '<button type="button" class="icon-btn of-cancel" aria-label="Close"><i data-lucide="x"></i></button>' : ''}
      </div>

      <label class="of-field">
        <span class="field-label">Name</span>
        <input class="input of-name" type="text" autocomplete="off" placeholder="e.g. Eric Hansen" value="${escapeHtml(initial.name || '')}" required />
      </label>

      <div class="of-link">
        <div class="of-linked" hidden>
          <i data-lucide="badge-check"></i>
          <span class="of-linked-text"></span>
          <button type="button" class="text-link of-unlink">Unlink</button>
        </div>
        <div class="of-suggest" hidden>
          <span class="of-suggest-label">Link to a rated player <span class="of-suggest-hint">(ratings + OTB games)</span></span>
          <div class="of-candidates"></div>
        </div>
      </div>

      <div class="of-grid">
        <label class="of-field">
          <span class="field-label">Chess.com</span>
          <input class="input of-chesscom" type="text" autocomplete="off" placeholder="username" value="${escapeHtml(initial.chesscom || '')}" />
        </label>
        <label class="of-field">
          <span class="field-label">Lichess</span>
          <input class="input of-lichess" type="text" autocomplete="off" placeholder="username" value="${escapeHtml(initial.lichess || '')}" />
        </label>
      </div>

      <details class="of-ids">
        <summary>Enter CFC / FIDE ids manually</summary>
        <div class="of-grid">
          <label class="of-field">
            <span class="field-label">CFC id</span>
            <input class="input of-cfc" type="text" inputmode="numeric" value="${escapeHtml(state.cfcId)}" />
          </label>
          <label class="of-field">
            <span class="field-label">FIDE id</span>
            <input class="input of-fide" type="text" inputmode="numeric" value="${escapeHtml(state.fideId)}" />
          </label>
        </div>
      </details>

      <div class="of-error prep-error" hidden></div>

      <div class="of-actions">
        ${onDelete ? '<button type="button" class="btn btn-danger-outline of-delete"><i data-lucide="trash-2"></i>Remove</button>' : ''}
        <span class="of-spacer"></span>
        ${onCancel ? '<button type="button" class="btn btn-ghost of-cancel-2">Cancel</button>' : ''}
        <button type="submit" class="btn btn-primary of-submit">${escapeHtml(submitLabel)}</button>
      </div>
    </form>
  `;
  refreshIcons();

  const form = el.querySelector('form');
  const nameEl = form.querySelector('.of-name');
  const cfcEl = form.querySelector('.of-cfc');
  const fideEl = form.querySelector('.of-fide');
  const linkedEl = form.querySelector('.of-linked');
  const suggestEl = form.querySelector('.of-suggest');
  const candEl = form.querySelector('.of-candidates');
  const errorEl = form.querySelector('.of-error');

  function showLinked() {
    const linked = Boolean(state.cfcId || state.fideId);
    linkedEl.hidden = !linked;
    if (linked) {
      form.querySelector('.of-linked-text').textContent = state.linkedLabel || linkLabel({ cfc_id: state.cfcId, fide_id: state.fideId });
      suggestEl.hidden = true;
    }
  }
  showLinked();

  // Debounced name search against CFC + FIDE.
  let timer = null;
  let searchSeq = 0;
  nameEl.addEventListener('input', () => {
    clearTimeout(timer);
    if (state.cfcId || state.fideId) return; // already linked
    const q = nameEl.value.trim();
    if (q.length < 3) {
      suggestEl.hidden = true;
      return;
    }
    timer = setTimeout(() => search(q), 350);
  });

  async function search(q) {
    const seq = ++searchSeq;
    suggestEl.hidden = false;
    candEl.innerHTML = '<div class="of-searching">Searching CFC and FIDE…</div>';
    try {
      const { candidates } = await api(`/otb/search?name=${encodeURIComponent(q)}`);
      if (seq !== searchSeq) return;
      if (!candidates.length) {
        candEl.innerHTML = '<div class="of-searching">No rated players found. You can still add them, or enter ids below.</div>';
        return;
      }
      candEl.innerHTML = '';
      for (const c of candidates.slice(0, 6)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'of-cand';
        const bits = [
          c.rating ? `${c.ratingLabel || 'FIDE'} ${c.rating}` : null,
          c.title,
          c.country,
          c.cfcId ? `CFC #${c.cfcId}` : c.fideId ? `FIDE #${c.fideId}` : null,
        ].filter(Boolean);
        btn.innerHTML = `
          <span class="of-cand-name">${escapeHtml(c.name)}</span>
          <span class="of-cand-meta">${escapeHtml(bits.join(' · '))}</span>
          <span class="of-cand-go">Link</span>`;
        btn.addEventListener('click', () => {
          state.cfcId = c.cfcId || '';
          state.fideId = c.fideId || '';
          state.rating = c.rating || null;
          state.linkedLabel = [c.name, ...bits].join(' · ');
          cfcEl.value = state.cfcId;
          fideEl.value = state.fideId;
          if (!nameEl.value.trim() || nameEl.value.trim().length < c.name.length) nameEl.value = c.name;
          showLinked();
        });
        candEl.appendChild(btn);
      }
    } catch {
      if (seq === searchSeq) candEl.innerHTML = '<div class="of-searching">Search is unavailable right now. Enter ids below instead.</div>';
    }
  }

  form.querySelector('.of-unlink').addEventListener('click', () => {
    state.cfcId = state.fideId = '';
    state.rating = null;
    state.linkedLabel = '';
    cfcEl.value = fideEl.value = '';
    showLinked();
    if (nameEl.value.trim().length >= 3) search(nameEl.value.trim());
  });
  for (const input of [cfcEl, fideEl]) {
    input.addEventListener('input', () => {
      state.cfcId = cfcEl.value.replace(/\D/g, '');
      state.fideId = fideEl.value.replace(/\D/g, '');
      state.linkedLabel = '';
      showLinked();
    });
  }

  for (const sel of ['.of-cancel', '.of-cancel-2']) {
    form.querySelector(sel)?.addEventListener('click', () => onCancel());
  }
  form.querySelector('.of-delete')?.addEventListener('click', () => onDelete());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameEl.value.trim();
    if (!name) {
      nameEl.focus();
      return;
    }
    const submit = form.querySelector('.of-submit');
    submit.disabled = true;
    errorEl.hidden = true;
    try {
      await onSubmit({
        name,
        chesscom: form.querySelector('.of-chesscom').value.trim(),
        lichess: form.querySelector('.of-lichess').value.trim(),
        cfcId: state.cfcId,
        fideId: state.fideId,
        rating: state.rating,
      });
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      submit.disabled = false;
    }
  });

  nameEl.focus();
  if (!initial.id && nameEl.value.trim().length >= 3) search(nameEl.value.trim());
}

function linkLabel(o) {
  return [o.cfc_id ? `CFC #${o.cfc_id}` : null, o.fide_id ? `FIDE #${o.fide_id}` : null].filter(Boolean).join(' · ');
}
