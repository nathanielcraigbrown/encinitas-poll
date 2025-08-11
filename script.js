import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://ucjuuicfjepgalzrxgba.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjanV1aWNmamVwZ2FsenJ4Z2JhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5MzkxNjcsImV4cCI6MjA3MDUxNTE2N30.5y7P63osiM_esrLyQ4hvtgoKwyfSbxDRNjvQOcE7QQs';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// DOM
const optionsList = document.getElementById('options');
const submitButton = document.getElementById('submit');
const clearButton = document.getElementById('clear');
const resetPollButton = document.getElementById('reset-poll');
const resultsContainer = document.getElementById('results');
const resultSummary = document.getElementById('result-summary');
const rankHint = document.getElementById('rank-hint');

// Helpers
function pluralize(n, one, many = null) {
  return n === 1 ? one : (many ?? one + 's');
}
function getSelects() {
  return Array.from(optionsList.querySelectorAll('select.rank-select'));
}

// Build ranking array from selects; validate 1..N each used once.
// Returns ranking array or null if invalid (and paints UI).
function readRankingOrNull() {
  const items = Array.from(optionsList.children);
  const N = items.length;
  const selects = getSelects();

  const values = selects.map((sel) => {
    const v = sel.value.trim();
    return v === '' ? NaN : parseInt(v, 10);
  });

  // Check bounds and uniqueness
  let ok = values.every((v) => Number.isInteger(v) && v >= 1 && v <= N);
  const seen = new Map();
  for (const v of values) {
    if (!Number.isFinite(v)) { ok = false; break; }
    seen.set(v, (seen.get(v) || 0) + 1);
  }
  const duplicates = Array.from(seen.entries()).filter(([,c]) => c > 1).map(([r]) => r);
  if (duplicates.length) ok = false;

  // UI feedback
  selects.forEach((sel, i) => {
    sel.classList.remove('ok','bad');
    const v = values[i];
    if (!Number.isFinite(v) || v < 1 || v > N) {
      if (sel.value !== '') sel.classList.add('bad');
    } else if (seen.get(v) > 1) {
      sel.classList.add('bad');
    } else {
      sel.classList.add('ok');
    }
  });

  if (!ok) {
    rankHint.textContent = `Please choose each number 1–${N} exactly once. No repeats and no blanks.`;
    rankHint.style.color = 'var(--warn)';
    return null;
  }

  // Sort candidates by chosen rank
  const pairs = items.map((li, i) => ({
    name: li.getAttribute('data-value'),
    rank: values[i],
  })).sort((a,b) => a.rank - b.rank);

  rankHint.textContent = 'Looks good — you can submit!';
  rankHint.style.color = 'var(--ok)';
  return pairs.map(p => p.name);
}

// Wire up select validation
getSelects().forEach((sel) => sel.addEventListener('change', readRankingOrNull));

// Clear form
clearButton.addEventListener('click', () => {
  getSelects().forEach((sel) => { sel.value = ''; sel.classList.remove('ok','bad'); });
  rankHint.textContent = 'Tip: 1 = top choice, 4 = last choice. No repeats.';
  rankHint.style.color = 'var(--muted)';
});

// Submit vote
submitButton.addEventListener('click', async () => {
  const ranking = readRankingOrNull();
  if (!ranking) return;

  submitButton.disabled = true;
  try {
    const { error } = await supabase.from('votes').insert({ ballot: ranking });
    if (error) throw error;
    submitButton.textContent = 'Vote submitted!';
  } catch (err) {
    console.error('Failed to submit vote', err);
    alert('An error occurred submitting your vote. Please try again later.');
    submitButton.disabled = false;
  }
});

// IRV tally + render
async function updateResults() {
  const { data: votes, error } = await supabase.from('votes').select('*');
  if (error) {
    console.error('Error fetching votes', error);
    resultsContainer.textContent = 'Error loading results';
    return;
  }
  const ballots = (votes || []).map((row) => row.ballot).filter(Boolean);
  if (ballots.length === 0) {
    resultSummary.textContent = 'No votes yet.';
    resultsContainer.innerHTML = '';
    return;
  }

  const allCandidates = Array.from(optionsList.children).map((li) => li.getAttribute('data-value'));
  const rounds = [];
  let remainingCandidates = [...allCandidates];
  let remainingBallots = ballots.map((b) => b.filter((c) => remainingCandidates.includes(c)));
  const totalVotes = remainingBallots.length;
  let roundNum = 1;

  while (true) {
    const counts = Object.fromEntries(remainingCandidates.map((c) => [c, 0]));
    for (const ballot of remainingBallots) if (ballot.length) counts[ballot[0]]++;

    rounds.push({ round: roundNum, counts: { ...counts }, respondents: totalVotes });

    let winner = null;
    for (const [cand, count] of Object.entries(counts)) {
      if (count > remainingBallots.length / 2) { winner = cand; break; }
    }
    if (winner || remainingCandidates.length <= 1) {
      resultSummary.textContent = winner
        ? `Winner so far: ${winner} (${Math.round((counts[winner] / totalVotes) * 100)}% of ballots)`
        : `Winner: ${remainingCandidates[0]}`;
      break;
    }

    const minVotes = Math.min(...Object.values(counts));
    const toEliminate = Object.keys(counts).filter((cand) => counts[cand] === minVotes);
    remainingCandidates = remainingCandidates.filter((c) => !toEliminate.includes(c));
    remainingBallots = remainingBallots
      .map((b) => b.filter((c) => remainingCandidates.includes(c)))
      .filter((b) => b.length > 0);

    roundNum++;
    if (!remainingBallots.length) break;
  }

  renderResults(rounds);
}

function renderResults(rounds) {
  resultsContainer.innerHTML = '';
  rounds.forEach((roundData) => {
    const div = document.createElement('div');
    div.classList.add('results-round');

    const header = document.createElement('h3');
    const ballotsLabel = `${roundData.respondents} ${pluralize(roundData.respondents, 'ballot')}`;
    header.textContent = `Round ${roundData.round} • ${ballotsLabel}`;
    div.appendChild(header);

    const sorted = Object.entries(roundData.counts).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([cand, count]) => {
      const row = document.createElement('div');
      row.classList.add('candidate-count');
      row.textContent = `${cand} — ${count} ${pluralize(count, 'vote')}`;
      div.appendChild(row);
    });

    resultsContainer.appendChild(div);
  });
}

// Realtime subscribe
supabase
  .channel('public:votes')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'votes' }, () => updateResults())
  .subscribe((status) => { if (status === 'SUBSCRIBED') updateResults(); });

// Reset poll (two-step confirm → delete all rows)
// NOTE: Requires a DELETE policy (see SQL below).
resetPollButton.addEventListener('click', async () => {
  if (!confirm('This will clear ALL votes for this poll. Continue?')) return;
  const second = prompt('Type RESET to permanently clear all voting history:');
  if (second !== 'RESET') return;

  try {
    const { error } = await supabase.from('votes').delete().neq('id', null);
    if (error) throw error;
    await updateResults();
    alert('All votes cleared.');
  } catch (err) {
    console.error('Delete failed (likely RLS). See README/SQL note.', err);
    alert('Unable to clear votes. You may need to enable a DELETE policy in Supabase (see instructions).');
  }
});
