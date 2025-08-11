import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://ucjuuicfjepgalzrxgba.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjanV1aWNmamVwZ2FsenJ4Z2JhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5MzkxNjcsImV4cCI6MjA3MDUxNTE2N30.5y7P63osiM_esrLyQ4hvtgoKwyfSbxDRNjvQOcE7QQs';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// DOM
const optionsList = document.getElementById('options');
const submitButton = document.getElementById('submit');
const resultsContainer = document.getElementById('results');
const resultSummary = document.getElementById('result-summary');

// SortableJS (single init)
new Sortable(optionsList, { animation: 150 });

// Helpers
function getCurrentRanking() {
  return Array.from(optionsList.children).map((li) => li.getAttribute('data-value'));
}
function pluralize(n, one, many = null) {
  return n === 1 ? one : (many ?? one + 's');
}

// Vote submit
submitButton.addEventListener('click', async () => {
  submitButton.disabled = true;
  const ballot = getCurrentRanking();
  try {
    const { error } = await supabase.from('votes').insert({ ballot });
    if (error) throw error;
    submitButton.textContent = 'Vote submitted!';
  } catch (err) {
    console.error('Failed to submit vote', err);
    alert('An error occurred submitting your vote. Please try again later.');
    submitButton.disabled = false;
  }
});

// Results
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

  const allCandidates = getCurrentRanking();
  const rounds = [];
  let remainingCandidates = [...allCandidates];
  let remainingBallots = ballots.map((b) => b.filter((c) => remainingCandidates.includes(c)));
  const totalVotes = remainingBallots.length;
  let roundNum = 1;

  while (true) {
    const counts = Object.fromEntries(remainingCandidates.map((c) => [c, 0]));
    for (const ballot of remainingBallots) {
      if (ballot.length) counts[ballot[0]]++;
    }
    rounds.push({ round: roundNum, counts: { ...counts }, total: remainingBallots.length });

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
    const ballotsLabel = `${roundData.total} ${pluralize(roundData.total, 'ballot')}`;
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

// Realtime updates
supabase
  .channel('public:votes')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'votes' }, () => updateResults())
  .subscribe((status) => { if (status === 'SUBSCRIBED') updateResults(); });
