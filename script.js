import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://ucjuuicfjepgalzrxgba.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjanV1aWNmamVwZ2FsenJ4Z2JhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5MzkxNjcsImV4cCI6MjA3MDUxNTE2N30.5y7P63osiM_esrLyQ4hvtgoKwyfSbxDRNjvQOcE7QQs';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// DOM
const optionsList = document.getElementById('options');
const submitButton = document.getElementById('submit');
const clearButton = document.getElementById('clear');
const resultsContainer = document.getElementById('results');
const resultSummary = document.getElementById('result-summary');
const rankHint = document.getElementById('rank-hint');

// Helpers
function pluralize(n, one, many = null) {
  return n === 1 ? one : (many ?? one + 's');
}

function clamp(n, min, max) {
  if (Number.isNaN(n)) return n;
  return Math.max(min, Math.min(max, n));
}

function getInputs() {
  return Array.from(optionsList.querySelectorAll('.rank-input'));
}

// Validate and (optionally) return ranking array.
// If invalid, show friendly hint and highlight issues; return null.
function readRankingOrNull() {
  const items = Array.from(optionsList.children); // <li> nodes
  const N = items.length;
  const inputs = getInputs();
  const values = inputs.map((inp) => {
    const v = parseInt(inp.value, 10);
    if (!Number.isFinite(v)) return NaN;
    return clamp(v, 1, N);
  });

  // basic bounds check
  let ok = values.every((v) => Number.isInteger(v) && v >= 1 && v <= N);

  // uniqueness check
  const seen = new Map(); // rank -> count
  for (const v of values) {
    if (!Number.isFinite(v)) { ok = false; break; }
    seen.set(v, (seen.get(v) || 0) + 1);
  }
  const duplicates = Array.from(seen.entries()).filter(([, c]) => c > 1).map(([r]) => r);
  if (duplicates.length) ok = false;

  // UI feedback: mark inputs
  inputs.forEach((inp, i) => {
    inp.classList.remove('ok', 'bad');
    const v = values[i];
    if (!Number.isFinite(v) || v < 1 || v > N) {
      if (inp.value !== '') inp.classList.add('bad');
    } else if (seen.get(v) > 1) {
      inp.classList.add('bad');
    } else {
      inp.classList.add('ok');
    }
  });

  if (!ok) {
    rankHint.textContent = `Please use each number 1–${N} exactly once. No repeats and no blanks.`;
    rankHint.style.color = 'var(--warn)';
    return null;
  }

  // Build ranking array: sort by numeric rank ascending
  const pairs = items.map((li, i) => ({
    name: li.getAttribute('data-value'),
    rank: values[i],
  }));
  pairs.sort((a, b) => a.rank - b.rank);
  const ranking = pairs.map((p) => p.name);

  rankHint.textContent = 'Looks good — you can submit!';
  rankHint.style.color = 'var(--ok)';
  return ranking;
}

// Events
getInputs().forEach((inp) => {
  inp.addEventListener('input', () => {
    // live-validate as they type
    readRankingOrNull();
  });
  // keep values within bounds
  inp.addEventListener('change', () => {
    const N = optionsList.children.length;
    const v = parseInt(inp.value, 10);
    if (Number.isFinite(v)) inp.value = String(clamp(v, 1, N));
    readRankingOrNull();
  });
});

clearButton.addEventListener('click', () => {
  getInputs().forEach((inp) => {
    inp.value = '';
    inp.classList.remove('ok', 'bad');
  });
  rankHint.textContent = 'Tip: 1 = top choice, 4 = last choice. Use each number once.';
  rankHint.style.color = 'var(--muted)';
});

// Submit vote
submitButton.addEventListener('click', async () => {
  const ranking = readRankingOrNull();
  if (!ranking) return; // invalid — hint already shown

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

// Compute & render results (Instant-Runoff Voting)
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
  const totalVotes = remainingBallots.length; // stable respondents
  let roundNum = 1;

  while (true) {
    const counts = Object.fromEntries(remainingCandidates.map((c) => [c, 0]));
    for (const ballot of remainingBallots) {
      if (ballot.length) counts[ballot[0]]++;
    }

    // record this counting round with friendly respondent count
    rounds.push({ round: roundNum, counts: { ...counts }, respondents: totalVotes });

    // majority?
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

    // eliminate lowest & transfer
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

    // Friendlier header: "Round X • Y ballots"
    const header = document.createElement('h3');
    const ballotsLabel = `${roundData.respondents} ${pluralize(roundData.respondents, 'ballot')}`;
    header.textContent = `Round ${roundData.round} • ${ballotsLabel}`;
    div.appendChild(header);

    // Display candidates sorted by vote count
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

// Realtime subscription (auto-updates on new votes)
supabase
  .channel('public:votes')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'votes' }, () => updateResults())
  .subscribe((status) => {
    if (status === 'SUBSCRIBED') updateResults();
  });
