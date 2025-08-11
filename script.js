import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
function pluralize(n, one, many = null) {
  return n === 1 ? one : (many ?? one + 's');
}

/*
  Supabase configuration. Replace these values with your own project URL
  and anonymous public API key. These values are safe to expose in a
  public client because row-level security (RLS) is enabled on the
  votes table to restrict operations.
*/
const SUPABASE_URL = 'https://ucjuuicfjepgalzrxgba.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVjanV1aWNmamVwZ2FsenJ4Z2JhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5MzkxNjcsImV4cCI6MjA3MDUxNTE2N30.5y7P63osiM_esrLyQ4hvtgoKwyfSbxDRNjvQOcE7QQs';

// Initialize the Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Grab DOM elements
const optionsList = document.getElementById('options');
const submitButton = document.getElementById('submit');
const resultsContainer = document.getElementById('results');
const resultSummary = document.getElementById('result-summary');

// Initialize SortableJS on our list
new Sortable(optionsList, {
  animation: 150,
  onEnd: () => {
    // Optionally highlight that order has changed
  },
});

// Helper to get the current ranking from the list items
function getCurrentRanking() {
  const items = Array.from(optionsList.children);
  return items.map((li) => li.getAttribute('data-value'));
}

// Submit vote handler
submitButton.addEventListener('click', async () => {
  submitButton.disabled = true;
  const ballot = getCurrentRanking();
  try {
    const { error } = await supabase.from('votes').insert({ ballot });
    if (error) throw error;
    submitButton.textContent = 'Vote submitted!';
    // Optionally reset after a delay so they could vote again from another device
  } catch (err) {
    console.error('Failed to submit vote', err);
    alert('An error occurred submitting your vote. Please try again later.');
  }
});

// Retrieve all votes and calculate ranked-choice results
async function updateResults() {
  // Fetch all ballots from the table
  const { data: votes, error } = await supabase.from('votes').select('*');
  if (error) {
    console.error('Error fetching votes', error);
    resultsContainer.textContent = 'Error loading results';
    return;
  }
  // Parse ballots into arrays of candidate names
  const ballots = (votes || []).map((row) => row.ballot).filter(Boolean);
  if (ballots.length === 0) {
    resultSummary.textContent = 'No votes yet.';
    resultsContainer.innerHTML = '';
    return;
  }
  // Candidates list derived from options so that if someone voted incorrectly we ignore unknown names
  const allCandidates = getCurrentRanking();
  // Run instant runoff algorithm
  const rounds = [];
  let remainingCandidates = [...allCandidates];
  let remainingBallots = ballots.map((ballot) => ballot.filter((cand) => remainingCandidates.includes(cand)));
  const totalVotes = remainingBallots.length;
  let roundNum = 1;
  while (true) {
    // Tally first-choice votes for each remaining candidate
    const counts = {};
    remainingCandidates.forEach((cand) => {
      counts[cand] = 0;
    });
    for (const ballot of remainingBallots) {
      if (ballot.length > 0) {
        const choice = ballot[0];
        counts[choice]++;
      }
    }
    // Record this round
    rounds.push({ round: roundNum, counts: { ...counts }, total: remainingBallots.length });
    // Check if any candidate has >50% of the votes
    let winner = null;
    for (const [cand, count] of Object.entries(counts)) {
      if (count > remainingBallots.length / 2) {
        winner = cand;
        break;
      }
    }
    if (winner || remainingCandidates.length <= 1) {
      // Winner found or only one candidate left
      resultSummary.textContent = winner
        ? `Winner: ${winner} with ${((counts[winner] / totalVotes) * 100).toFixed(0)}% of valid votes`
        : `Winner: ${remainingCandidates[0]} (only candidate remaining)`;
      break;
    }
    // Find candidate(s) with the fewest votes
    const minVotes = Math.min(...Object.values(counts));
    const toEliminate = Object.keys(counts).filter((cand) => counts[cand] === minVotes);
    // Remove eliminated candidates from remainingCandidates
    remainingCandidates = remainingCandidates.filter((cand) => !toEliminate.includes(cand));
    // Remove eliminated candidates from each ballot
    remainingBallots = remainingBallots
      .map((ballot) => ballot.filter((cand) => remainingCandidates.includes(cand)))
      .filter((ballot) => ballot.length > 0);
    roundNum++;
    if (remainingBallots.length === 0) break;
  }
  // Render results
  renderResults(rounds);
}

// Render rounds results to the DOM
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
      // One readable line: “Name — 2 votes”
      row.textContent = `${cand} — ${count} ${pluralize(count, 'vote')}`;
      div.appendChild(row);
    });

    resultsContainer.appendChild(div);
  });
}


    div.appendChild(header);
    // Sort candidates by vote count descending for display
    const sorted = Object.entries(roundData.counts).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([cand, count]) => {
      const item = document.createElement('div');
      item.classList.add('candidate-count');
      const nameSpan = document.createElement('span');
      nameSpan.textContent = cand;
      const countSpan = document.createElement('span');
      countSpan.textContent = `${count}`;
      item.appendChild(nameSpan);
      item.appendChild(countSpan);
      div.appendChild(item);
    });
    resultsContainer.appendChild(div);
  });
}

// Subscribe to realtime changes so that results update automatically when new votes are inserted
function subscribeToChanges() {
  const channel = supabase
    .channel('public:votes')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'votes' },
      (payload) => {
        // New vote inserted — update results
        updateResults();
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // Load initial results once subscription is ready
        updateResults();
      }
    });
}

// Kick off
subscribeToChanges();
