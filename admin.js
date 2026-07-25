/**
 * admin.js — UCL Admin Panel (two-leg knockout)
 */

import {
    initializeTournament, onMatchesUpdate, onTournamentUpdate,
    submitMatchResult, clearMatchResult, startKnockoutStage,
    resetTournament, loginAdmin, logoutAdmin, getCurrentUser,
    onAuthStateChanged, GROUP_NAMES, auth
} from './firebase.js';

const state = { user: null, tournament: null, matches: [], unsubscribes: [] };

window.addEventListener('DOMContentLoaded', initAdmin);

async function initAdmin() {
    setupEventListeners();
    const user = await getCurrentUser();
    if (user) { state.user = user; showDashboard(); setupListeners(); }
    else showLoginPage();

    onAuthStateChanged(auth, (user) => {
        if (user) { state.user = user; showDashboard(); setupListeners(); }
        else { state.user = null; cleanupListeners(); showLoginPage(); }
    });
}

// ── Events ────────────────────────────────────────────────────────────────────
function setupEventListeners() {
    document.getElementById('loginButton')              ?.addEventListener('click', handleLogin);
    document.getElementById('loginPassword')            ?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });
    document.getElementById('logoutButton')             ?.addEventListener('click', handleLogout);
    document.getElementById('generateTournamentButton') ?.addEventListener('click', handleGenerate);
    document.getElementById('loadDefaultTeamsButton')   ?.addEventListener('click', loadDefaultTeams);
    document.getElementById('resetTournamentButton')    ?.addEventListener('click', handleReset);
    document.getElementById('startKnockoutButton')      ?.addEventListener('click', handleStartKnockout);
    document.getElementById('submitResultButton')       ?.addEventListener('click', handleSubmitResult);
    document.getElementById('clearResultButton')        ?.addEventListener('click', handleClearResult);
    document.getElementById('groupFilter')              ?.addEventListener('change', renderMatchSelect);
    document.getElementById('adminMatchSelect')         ?.addEventListener('change', onMatchChange);
    document.getElementById('penaltyToggle')            ?.addEventListener('change', (e) => {
        const sel = document.getElementById('penaltyWinnerSelect');
        if (sel) sel.style.display = e.target.checked ? 'block' : 'none';
    });
}

// ── Auth ──────────────────────────────────────────────────────────────────────
function showLoginPage() {
    document.getElementById('loginContainer').style.display = 'flex';
    document.getElementById('adminContent').classList.remove('active');
}
function showDashboard() {
    document.getElementById('loginContainer').style.display = 'none';
    document.getElementById('adminContent').classList.add('active');
    setEl('adminEmail', state.user?.email || 'Admin');
}
function showLoginError(msg) { const el = document.getElementById('loginError'); if (el) { el.textContent = msg; el.style.display = 'block'; } }

async function handleLogin() {
    const email = document.getElementById('loginEmail')?.value.trim();
    const pass  = document.getElementById('loginPassword')?.value;
    if (!email || !pass) { showLoginError('Enter email and password.'); return; }
    try { await loginAdmin(email, pass); }
    catch (e) { showLoginError(e.message || 'Login failed.'); }
}
async function handleLogout() {
    if (!confirm('Logout?')) return;
    try { await logoutAdmin(); cleanupListeners(); showLoginPage(); }
    catch (e) { alert('Logout failed: ' + e.message); }
}

// ── Realtime ──────────────────────────────────────────────────────────────────
function setupListeners() {
    if (state.unsubscribes.length) return;
    const u1 = onTournamentUpdate((t) => { state.tournament = t || {}; renderAdminStats(); renderGroupOverview(); renderMatchSelect(); });
    const u2 = onMatchesUpdate((m)    => { state.matches    = m || []; renderAdminStats(); renderGroupOverview(); renderMatchSelect(); });
    state.unsubscribes = [u1, u2];
}
function cleanupListeners() { state.unsubscribes.forEach((f) => f()); state.unsubscribes = []; }

// ── Tournament handlers ───────────────────────────────────────────────────────
async function handleGenerate() {
    const countdownVal = document.getElementById('countdownDateTime')?.value;
    if (!countdownVal) { alert('Please set a countdown date.'); return; }
    const teamsByGroup = {};
    let valid = true;
    GROUP_NAMES.forEach((g) => {
        const teams = (document.getElementById(`group${g}Input`)?.value || '').split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
        if (teams.length !== 4) { alert(`Group ${g} needs exactly 4 teams (found ${teams.length}).`); valid = false; }
        teamsByGroup[g] = teams;
    });
    if (!valid) return;
    if (!confirm('Create tournament? All existing data will be overwritten.')) return;
    try {
        showLoading('Creating tournament…');
        await resetTournament();
        await initializeTournament(teamsByGroup, new Date(countdownVal));
        showSuccess('✅ Tournament created! 48 group fixtures generated (12 per group).');
    } catch (e) { alert('Error: ' + e.message); }
    finally { hideLoading(); }
}

async function handleStartKnockout() {
    if (!confirm('Start knockout stage with top 2 from each group (8 teams)?')) return;
    try {
        showLoading('Starting knockout…');
        await startKnockoutStage();
        showSuccess('🔥 Quarter Finals ready! (Two legs each)');
    } catch (e) { alert('Error: ' + e.message); }
    finally { hideLoading(); }
}

async function handleReset() {
    if (!confirm('⚠️ Reset ENTIRE tournament? All data deleted permanently.')) return;
    try { showLoading('Resetting…'); await resetTournament(); showSuccess('♻️ Tournament reset.'); }
    catch (e) { alert('Error: ' + e.message); }
    finally { hideLoading(); }
}

// ── Result handlers ───────────────────────────────────────────────────────────
async function handleSubmitResult() {
    const sel    = document.getElementById('adminMatchSelect');
    const score1 = Number(document.getElementById('adminScore1')?.value);
    const score2 = Number(document.getElementById('adminScore2')?.value);

    if (!sel?.value)                           { alert('Select a match.'); return; }
    if (!Number.isFinite(score1) || score1 < 0) { alert('Invalid Team 1 score.'); return; }
    if (!Number.isFinite(score2) || score2 < 0) { alert('Invalid Team 2 score.'); return; }

    const match = state.matches.find((m) => m.id === sel.value);
    let penaltyWinnerId = null, penaltyWinnerName = null;

    // Penalties needed for: Final if level, or Leg 2 if aggregate level
    const mightNeedPens = match && (match.isFinal || match.leg === 2);
    if (mightNeedPens) {
        // Check if it would be a level aggregate (Leg 2) or level score (Final)
        let isLevel = false;
        if (match.isFinal) {
            isLevel = score1 === score2;
        } else if (match.leg === 2) {
            const leg1 = state.matches.find((m) => m.tieId === match.tieId && m.leg === 1);
            if (leg1?.status === 'completed') {
                const agg1 = Number(leg1.score1) + score1;
                const agg2 = Number(leg1.score2) + score2;
                isLevel = agg1 === agg2;
            }
        }
        if (isLevel) {
            const penToggle = document.getElementById('penaltyToggle');
            if (!penToggle?.checked) { alert('The tie is level. Tick "Penalties" and select the shoot-out winner.'); return; }
            const penSel = document.getElementById('penaltyWinnerSelect');
            penaltyWinnerId   = penSel?.value;
            penaltyWinnerName = penSel?.options[penSel.selectedIndex]?.text;
            if (!penaltyWinnerId) { alert('Select the penalty shoot-out winner.'); return; }
        }
    }

    try {
        showLoading('Submitting result…');
        await submitMatchResult(sel.value, score1, score2, penaltyWinnerId, penaltyWinnerName);
        showSuccess('✅ Result saved.');
        clearForm();
    } catch (e) { alert('Error: ' + e.message); }
    finally { hideLoading(); }
}

async function handleClearResult() {
    const sel = document.getElementById('adminMatchSelect');
    if (!sel?.value) { alert('Select a match.'); return; }
    if (!confirm('Clear this result?')) return;
    try {
        showLoading('Clearing…');
        await clearMatchResult(sel.value);
        showSuccess('🗑 Result cleared.');
        clearForm();
    } catch (e) { alert('Error: ' + e.message); }
    finally { hideLoading(); }
}

function clearForm() {
    ['adminScore1', 'adminScore2'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
    const sel = document.getElementById('adminMatchSelect'); if (sel) sel.value = '';
    const pt  = document.getElementById('penaltyToggle');   if (pt)  pt.checked = false;
    const ps  = document.getElementById('penaltyWinnerSelect'); if (ps) ps.style.display = 'none';
    updateAggregatePreview(null);
}

// ── Match select dropdown ─────────────────────────────────────────────────────
function renderMatchSelect() {
    const select      = document.getElementById('adminMatchSelect');
    const groupFilter = document.getElementById('groupFilter')?.value || 'all';
    if (!select) return;

    select.innerHTML = '<option value="">— Select Match —</option>';

    // Group matches
    const groupMatches = state.matches
        .filter((m) => m.matchType === 'group' && m.team1Name && m.team2Name)
        .filter((m) => groupFilter === 'all' || m.group === groupFilter)
        .sort((a, b) => a.group.localeCompare(b.group) || a.matchday - b.matchday || a.matchNumber - b.matchNumber);

    if (groupMatches.length) {
        const grp = document.createElement('optgroup');
        grp.label = '📋 Group Stage';
        select.appendChild(grp);
        groupMatches.forEach((m) => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = `[Grp ${m.group} MD${m.matchday}] ${m.team1Name} vs ${m.team2Name}${m.status === 'completed' ? ' ✅' : ''}`;
            select.appendChild(opt);
        });
    }

    if (groupFilter !== 'all' && !['A','B','C','D'].includes(groupFilter)) {
        // Knockout only — handled below
    }

    // Knockout matches — group by round, show leg label
    const roundOrder = { 'Quarter Finals': 0, 'Semi Finals': 1, 'Final': 2 };
    const knockoutMatches = state.matches
        .filter((m) => m.matchType === 'knockout' && m.team1Name && m.team2Name)
        .filter(() => groupFilter === 'all' || groupFilter === 'knockout')
        .sort((a, b) => (roundOrder[a.round] || 0) - (roundOrder[b.round] || 0) || (a.tieNumber - b.tieNumber) || (a.leg - b.leg));

    if (knockoutMatches.length) {
        const grp = document.createElement('optgroup');
        grp.label = '🏆 Knockout Stage';
        select.appendChild(grp);
        knockoutMatches.forEach((m) => {
            const opt = document.createElement('option');
            opt.value = m.id;
            const legLabel = m.isFinal ? '(Single Leg)' : `Leg ${m.leg}`;
            opt.textContent = `${m.round} ${legLabel}: ${m.team1Name} vs ${m.team2Name}${m.status === 'completed' ? ' ✅' : ''}`;
            select.appendChild(opt);
        });
    }
}

function onMatchChange() {
    const sel = document.getElementById('adminMatchSelect');
    const match = state.matches.find((m) => m.id === sel?.value);
    const penRow = document.getElementById('penaltyRow');
    const penSel = document.getElementById('penaltyWinnerSelect');
    const penToggle = document.getElementById('penaltyToggle');
    const penSelEl  = document.getElementById('penaltyWinnerSelect');

    if (!penRow) return;

    const isKnockout = match?.matchType === 'knockout';
    penRow.style.display = isKnockout ? 'block' : 'none';

    if (isKnockout && match && penSel) {
        penSel.innerHTML = `
            <option value="">— Penalty winner —</option>
            <option value="${match.team1Id}">${match.team1Name}</option>
            <option value="${match.team2Id}">${match.team2Name}</option>`;
        penSel.style.display = 'none';
    }
    if (penToggle) penToggle.checked = false;

    // Show aggregate preview for Leg 2
    if (match?.leg === 2) {
        const leg1 = state.matches.find((m) => m.tieId === match.tieId && m.leg === 1);
        updateAggregatePreview(leg1);
    } else {
        updateAggregatePreview(null);
    }

    // Pre-fill scores if editing a completed match
    if (match?.status === 'completed') {
        const s1 = document.getElementById('adminScore1'), s2 = document.getElementById('adminScore2');
        if (s1) s1.value = match.score1 ?? '';
        if (s2) s2.value = match.score2 ?? '';
    }
}

/** Show Leg 1 result as context when entering Leg 2 */
function updateAggregatePreview(leg1) {
    const el = document.getElementById('aggPreview');
    if (!el) return;
    if (!leg1 || leg1.status !== 'completed') { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML = `
        <strong>Leg 1 result:</strong> ${leg1.team1Name} ${leg1.score1}–${leg1.score2} ${leg1.team2Name}
        <br><span style="color:#aaa;font-size:12px;">Aggregate will update automatically after you enter Leg 2 score.</span>`;
}

// ── Render stats ──────────────────────────────────────────────────────────────
function renderAdminStats() {
    const gm  = state.matches.filter((m) => m.matchType === 'group');
    const km  = state.matches.filter((m) => m.matchType === 'knockout');
    setEl('adminTeamCount',        state.tournament?.teamsCount || 0);
    setEl('adminGroupProgress',    `${gm.filter((m) => m.status === 'completed').length}/${gm.length}`);
    setEl('adminKnockoutProgress', `${km.filter((m) => m.status === 'completed').length}/${km.length}`);
    setEl('adminStage',            state.tournament?.currentStage || 'Group');
    setEl('adminChampion',         state.tournament?.champion || '–');
}

// ── Group/bracket overview ────────────────────────────────────────────────────
function renderGroupOverview() {
    const container = document.getElementById('adminGroupOverview');
    if (!container) return;

    const groupTables = state.tournament?.groupTables || {};
    if (!Object.keys(groupTables).length) {
        container.innerHTML = '<p class="empty-state">No tournament yet. Create one above.</p>';
        return;
    }

    const groupsHtml = GROUP_NAMES.map((g) => {
        const table = groupTables[g] || [];
        const rows  = table.map((t, i) => `
            <tr class="${i < 2 ? 'row-top8' : ''}">
                <td>${i + 1}</td><td>${t.name}</td>
                <td>${t.P}</td><td>${t.W}</td><td>${t.D}</td><td>${t.L}</td>
                <td>${t.GF}</td><td>${t.GA}</td>
                <td>${t.GD >= 0 ? '+' : ''}${t.GD}</td><td><strong>${t.Pts}</strong></td>
            </tr>`).join('');

        return `
            <div class="card" style="padding:16px; margin-bottom:16px;">
                <h3 style="color:var(--gold); margin-bottom:10px;">Group ${g}</h3>
                <table class="league-table-el">
                    <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }).join('');

    // Two-leg knockout summary
    const knockoutMatches = state.matches.filter((m) => m.matchType === 'knockout');
    const roundOrder = ['Quarter Finals', 'Semi Finals', 'Final'];
    const knockoutHtml = knockoutMatches.length
        ? `<div class="bracket" style="margin-top:20px;">${roundOrder.map((rName) => {
            const rMatches = knockoutMatches.filter((m) => m.round === rName);
            if (!rMatches.length) return '';

            if (rName === 'Final') {
                const finalMatch = rMatches[0];
                return `<div class="round"><h3>⭐ Final</h3>
                    <div class="match ${finalMatch.status === 'completed' ? 'match-done' : ''}">
                        <div class="team ${finalMatch.status === 'completed' && finalMatch.winnerId === finalMatch.team1Id ? 'winner' : ''}">${finalMatch.team1Name || 'TBD'}<strong>${finalMatch.score1 ?? '-'}</strong></div>
                        <div class="team ${finalMatch.status === 'completed' && finalMatch.winnerId === finalMatch.team2Id ? 'winner' : ''}">${finalMatch.team2Name || 'TBD'}<strong>${finalMatch.score2 ?? '-'}</strong></div>
                        <div class="match-status">${finalMatch.status === 'completed' ? '🏆 ' + finalMatch.winnerName : '⏳ Pending'}</div>
                    </div></div>`;
            }

            const tieIds = [...new Set(rMatches.map((m) => m.tieId))].sort();
            const tieCards = tieIds.map((tieId) => {
                const leg1 = rMatches.find((m) => m.tieId === tieId && m.leg === 1);
                const leg2 = rMatches.find((m) => m.tieId === tieId && m.leg === 2);
                if (!leg1) return '';
                const tieStatus = leg2?.tieStatus || 'pending';
                const isCompleted = tieStatus === 'completed';
                const agg1 = leg2?.agg1 ?? leg1?.agg1 ?? null;
                const agg2 = leg2?.agg2 ?? leg1?.agg2 ?? null;
                const winnerId = leg2?.winnerId || leg1?.winnerId;
                return `
                    <div class="match ${isCompleted ? 'match-done' : ''}">
                        <div class="team ${isCompleted && winnerId === leg1.team1Id ? 'winner' : ''}">${leg1.team1Name || 'TBD'}</div>
                        <div class="team ${isCompleted && winnerId === leg1.team2Id ? 'winner' : ''}">${leg1.team2Name || 'TBD'}</div>
                        <div style="font-size:12px; color:#aaa; margin-top:6px;">
                            L1: ${leg1.status === 'completed' ? `${leg1.score1}–${leg1.score2}` : '–'}
                            &nbsp;|&nbsp;
                            L2: ${leg2?.status === 'completed' ? `${leg2.score1}–${leg2.score2}` : '–'}
                            ${agg1 !== null ? `<br>Agg: ${agg1}–${agg2}` : ''}
                            ${isCompleted && (leg2?.penaltyWinnerId || leg1?.penaltyWinnerId) ? ' ⚡pens' : ''}
                        </div>
                        <div class="match-status">${isCompleted ? '✅ ' + (leg2?.winnerName || leg1?.winnerName) + ' advance' : tieStatus === 'leg1_done' ? '⏳ Leg 2 pending' : '⏳ Pending'}</div>
                    </div>`;
            }).join('');

            return `<div class="round"><h3>${rName}</h3>${tieCards}</div>`;
        }).join('')}</div>`
        : '<p class="empty-state">Knockout bracket will appear after all group matches are complete.</p>';

    container.innerHTML = groupsHtml + knockoutHtml;
}

// ── Default teams ─────────────────────────────────────────────────────────────
function loadDefaultTeams() {
    const defaults = {
        A: ['Real Madrid', 'Manchester City', 'PSG', 'Galatasaray'],
        B: ['Barcelona', 'Bayern Munich', 'Arsenal', 'Celtic'],
        C: ['Liverpool', 'Borussia Dortmund', 'Atletico Madrid', 'AC Milan'],
        D: ['Inter Milan', 'Juventus', 'Newcastle United', 'Benfica']
    };
    GROUP_NAMES.forEach((g) => {
        const el = document.getElementById(`group${g}Input`);
        if (el) el.value = defaults[g].join('\n');
    });
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function showSuccess(msg) {
    const box = document.getElementById('successMessage'), txt = document.getElementById('successText');
    if (!box || !txt) return;
    txt.textContent = msg; box.style.display = 'block';
    setTimeout(() => { box.style.display = 'none'; }, 4000);
}
function showLoading(msg = 'Please wait…') {
    const el = document.getElementById('loadingOverlay'), txt = document.getElementById('loadingMessage');
    if (el) el.style.display = 'flex'; if (txt) txt.textContent = msg;
}
function hideLoading() { const el = document.getElementById('loadingOverlay'); if (el) el.style.display = 'none'; }
function setEl(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
