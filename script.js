/**
 * script.js — Champions League EFB Tournament (public site)
 * Two-leg knockout · Clean image downloads for fixtures & results
 */

import { onMatchesUpdate, onTournamentUpdate, onTeamsUpdate, GROUP_NAMES } from './firebase.js';

const state = {
    tournament: null,
    matches: [],
    teams: {},
    activeGroup: 'A',
    screenshotMode: false
};

window.addEventListener('DOMContentLoaded', initApp);

function initApp() {
    setupCountdown();
    setupDownloadButtons();
    setupScreenshotMode();
    setupModalEvents();
    setupRealtimeListeners();
}

function setupRealtimeListeners() {
    onTournamentUpdate((t) => { state.tournament = t || {}; renderPage(); });
    onMatchesUpdate((m)   => { state.matches    = m || []; renderPage(); });
    onTeamsUpdate((t)     => { state.teams      = t || {}; renderPage(); });
}

// ── Countdown ─────────────────────────────────────────────────────────────────
function setupCountdown() {
    const el = document.getElementById('countdown');
    if (!el) return;
    function tick() {
        if (!state.tournament?.countdownDate) { el.textContent = 'Loading…'; return; }
        const diff = new Date(state.tournament.countdownDate).getTime() - Date.now();
        if (diff <= 0) { el.textContent = '🏁 Tournament Started!'; return; }
        const d = Math.floor(diff / 86400000), h = Math.floor((diff/3600000)%24),
              m = Math.floor((diff/60000)%60),  s = Math.floor((diff/1000)%60);
        el.textContent = `${d}d ${h}h ${m}m ${s}s`;
    }
    tick(); setInterval(tick, 1000);
}

// ── Screenshot mode ───────────────────────────────────────────────────────────
function setupScreenshotMode() {
    const btn = document.getElementById('screenshotModeBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        state.screenshotMode = !state.screenshotMode;
        document.body.classList.toggle('screenshot-mode', state.screenshotMode);
        btn.textContent = state.screenshotMode ? '🔓 Exit Screenshot Mode' : '📸 Screenshot Mode';
    });
}

// ── Download buttons ──────────────────────────────────────────────────────────
function setupDownloadButtons() {
    document.getElementById('downloadGroupsBtn')
        ?.addEventListener('click', () => downloadGroupImage(state.activeGroup));

    document.getElementById('downloadResultsBtn')
        ?.addEventListener('click', () => downloadResultsImage(state.activeGroup));

    document.getElementById('downloadKnockoutBtn')
        ?.addEventListener('click', downloadKnockoutImage);

    document.getElementById('downloadBtn')
        ?.addEventListener('click', downloadChampionImage);
}

// ─────────────────────────────────────────────────────────────────────────────
//  IMAGE CARD BUILDERS
//  Each function builds a hidden, styled <div>, captures it with html2canvas,
//  downloads the PNG, then removes the element.
// ─────────────────────────────────────────────────────────────────────────────

/** Shared: inject an off-screen card, capture it, remove it */
async function captureCard(buildFn, filename) {
    if (typeof html2canvas !== 'function') { alert('Screenshot library not loaded.'); return; }

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
        position:fixed; left:-9999px; top:0;
        width:520px; background:#040d1a;
        font-family:'Poppins',sans-serif; color:#fff;
        border-radius:0; overflow:hidden; z-index:-1;
    `;
    document.body.appendChild(wrapper);
    buildFn(wrapper);

    try {
        const canvas = await html2canvas(wrapper, {
            backgroundColor: '#040d1a',
            scale: 3,
            useCORS: true,
            allowTaint: true,
            logging: false
        });
        const a = document.createElement('a');
        a.href     = canvas.toDataURL('image/png');
        a.download = filename;
        a.click();
    } catch (e) {
        alert('Download failed: ' + e.message);
    } finally {
        document.body.removeChild(wrapper);
    }
}

/** Branded header used on every download card */
function cardHeader(group = '') {
    return `
        <div style="
            background:linear-gradient(135deg,#001489,#00063a);
            padding:18px 22px 14px;
            border-bottom:2px solid #FFD700;
            display:flex; align-items:center; gap:14px;
        ">
            <span style="font-size:28px;">🏆</span>
            <div>
                <div style="font-size:15px;font-weight:700;color:#FFD700;letter-spacing:.5px;">
                    Champions League EFB Tournament
                </div>
                <div style="font-size:12px;color:#c8d6f5;margin-top:2px;">
                    ${group ? 'Group ' + group + ' · ' : ''}${new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}
                </div>
            </div>
        </div>`;
}

/** Footer strip */
function cardFooter() {
    return `
        <div style="
            background:#00063a;padding:10px 22px;
            border-top:1px solid rgba(255,215,0,.2);
            display:flex;justify-content:space-between;align-items:center;
        ">
            <span style="font-size:11px;color:#556;">★ UCL EFB Tournament ★</span>
            <span style="font-size:11px;color:#556;">Admin: 08024348605</span>
        </div>`;
}

// ── Download: Group Fixtures (pending + all) ──────────────────────────────────
async function downloadGroupImage(group) {
    const groupMatches = state.matches
        .filter((m) => m.matchType === 'group' && m.group === group)
        .sort((a, b) => a.matchday - b.matchday || a.matchNumber - b.matchNumber);

    if (!groupMatches.length) { alert('No fixtures found for Group ' + group); return; }

    await captureCard((wrapper) => {
        // Group by matchday
        const byDay = {};
        groupMatches.forEach((m) => {
            byDay[m.matchday] = byDay[m.matchday] || [];
            byDay[m.matchday].push(m);
        });

        const matchdayHtml = Object.keys(byDay).map((day) => `
            <div style="margin:0 0 4px;">
                <div style="
                    font-size:11px;font-weight:700;letter-spacing:1px;
                    color:#4d8aff;padding:6px 22px;
                    background:rgba(26,86,232,.12);
                ">MATCHDAY ${day}</div>
                ${byDay[day].map((m) => fixtureRow(m)).join('')}
            </div>
        `).join('');

        wrapper.innerHTML = `
            ${cardHeader(group)}
            <div style="padding:14px 0 6px;">
                <div style="font-size:13px;font-weight:700;color:#fff;
                    padding:0 22px 10px;letter-spacing:.5px;">
                    📅 Group ${group} Fixtures
                </div>
                ${matchdayHtml}
            </div>
            ${cardFooter()}`;
    }, `group-${group}-fixtures.png`);
}

// ── Download: Group Results (completed only) ──────────────────────────────────
async function downloadResultsImage(group) {
    const results = state.matches
        .filter((m) => m.matchType === 'group' && m.group === group && m.status === 'completed')
        .sort((a, b) => a.matchday - b.matchday || a.matchNumber - b.matchNumber);

    if (!results.length) { alert('No results yet for Group ' + group); return; }

    // Also build group table
    const table = (state.tournament?.groupTables || {})[group] || [];

    await captureCard((wrapper) => {
        const tableRows = table.map((t, i) => `
            <div style="
                display:flex;align-items:center;gap:0;
                padding:7px 12px;
                background:${i < 2 ? 'rgba(46,204,113,.1)' : i % 2 === 0 ? 'rgba(255,255,255,.03)' : 'transparent'};
                border-left:${i < 2 ? '3px solid #2ECC71' : '3px solid transparent'};
            ">
                <span style="width:24px;font-size:13px;font-weight:700;color:${i < 2 ? '#2ECC71' : '#aaa'};">${i+1}</span>
                <span style="flex:1;font-size:13px;font-weight:600;color:#fff;">${t.name}</span>
                <span style="width:28px;text-align:center;font-size:12px;color:#aaa;">${t.P}</span>
                <span style="width:28px;text-align:center;font-size:12px;color:#2ECC71;">${t.W}</span>
                <span style="width:28px;text-align:center;font-size:12px;color:#aaa;">${t.D}</span>
                <span style="width:28px;text-align:center;font-size:12px;color:#E74C3C;">${t.L}</span>
                <span style="width:36px;text-align:center;font-size:12px;color:${t.GD>0?'#2ECC71':t.GD<0?'#E74C3C':'#aaa'};">
                    ${t.GD>0?'+':''}${t.GD}
                </span>
                <span style="width:32px;text-align:center;font-size:14px;font-weight:700;color:#FFD700;">${t.Pts}</span>
            </div>`).join('');

        const resultRows = results.map((m) => fixtureRow(m)).join('');

        wrapper.innerHTML = `
            ${cardHeader(group)}
            <div style="padding:14px 0 0;">

                <!-- Table -->
                <div style="font-size:13px;font-weight:700;color:#fff;padding:0 22px 8px;letter-spacing:.5px;">
                    📊 Standings
                </div>
                <!-- Table header -->
                <div style="display:flex;padding:5px 12px;background:rgba(0,20,137,.6);">
                    <span style="width:24px;"></span>
                    <span style="flex:1;font-size:11px;color:#aaa;font-weight:600;">TEAM</span>
                    <span style="width:28px;text-align:center;font-size:11px;color:#aaa;">P</span>
                    <span style="width:28px;text-align:center;font-size:11px;color:#aaa;">W</span>
                    <span style="width:28px;text-align:center;font-size:11px;color:#aaa;">D</span>
                    <span style="width:28px;text-align:center;font-size:11px;color:#aaa;">L</span>
                    <span style="width:36px;text-align:center;font-size:11px;color:#aaa;">GD</span>
                    <span style="width:32px;text-align:center;font-size:11px;color:#aaa;">PTS</span>
                </div>
                ${tableRows}

                <!-- Results -->
                <div style="font-size:13px;font-weight:700;color:#fff;
                    padding:14px 22px 8px;letter-spacing:.5px;border-top:1px solid rgba(255,255,255,.07);margin-top:8px;">
                    ✅ Results
                </div>
                ${resultRows}
            </div>
            ${cardFooter()}`;
    }, `group-${group}-results.png`);
}

/** Single fixture row used in both cards */
function fixtureRow(match) {
    const isDone  = match.status === 'completed';
    const score   = isDone ? `${match.score1}  –  ${match.score2}` : 'vs';
    const scoreColor = isDone ? '#FFD700' : '#667';
    const bg      = isDone ? 'rgba(46,204,113,.05)' : 'transparent';
    const border  = isDone ? 'rgba(46,204,113,.15)' : 'rgba(255,255,255,.05)';

    return `
        <div style="
            display:flex;align-items:center;
            padding:9px 22px;
            background:${bg};
            border-bottom:1px solid ${border};
            gap:8px;
        ">
            <span style="flex:1;font-size:13px;font-weight:600;color:#fff;text-align:right;">
                ${match.team1Name}
            </span>
            <span style="
                min-width:80px;text-align:center;
                font-size:${isDone ? '16px' : '13px'};
                font-weight:700;color:${scoreColor};
                background:rgba(255,215,0,.07);
                padding:4px 10px;border-radius:6px;
            ">${score}</span>
            <span style="flex:1;font-size:13px;font-weight:600;color:#fff;text-align:left;">
                ${match.team2Name}
            </span>
            ${isDone ? '<span style="font-size:10px;color:#2ECC71;font-weight:700;">FT</span>' :
                       '<span style="font-size:10px;color:#556;font-weight:600;">TBD</span>'}
        </div>`;
}

// ── Download: Knockout bracket ────────────────────────────────────────────────
async function downloadKnockoutImage() {
    const knockoutMatches = state.matches.filter((m) => m.matchType === 'knockout');
    if (!knockoutMatches.length) { alert('Knockout stage has not started yet.'); return; }

    const rounds = ['Quarter Finals', 'Semi Finals', 'Final'];

    await captureCard((wrapper) => {
        const roundsHtml = rounds.map((round) => {
            const rMatches = knockoutMatches.filter((m) => m.round === round);
            if (!rMatches.length) return '';

            if (round === 'Final') {
                const m = rMatches[0];
                const isDone = m.status === 'completed';
                return `
                    ${roundLabel('⭐ Final')}
                    ${knockoutRow(
                        m.team1Name || 'TBD', m.score1,
                        m.team2Name || 'TBD', m.score2,
                        isDone, m.winnerId === m.team1Id, m.winnerId === m.team2Id,
                        m.penaltyWinnerId ? '⚡ pens' : ''
                    )}`;
            }

            // Two-leg ties
            const tieIds = [...new Set(rMatches.map((m) => m.tieId))].sort();
            return `
                ${roundLabel(round)}
                ${tieIds.map((tieId) => {
                    const leg1 = rMatches.find((m) => m.tieId === tieId && m.leg === 1);
                    const leg2 = rMatches.find((m) => m.tieId === tieId && m.leg === 2);
                    if (!leg1) return '';
                    const tieStatus  = leg2?.tieStatus || leg1?.tieStatus || 'pending';
                    const isComplete = tieStatus === 'completed';
                    const agg1 = leg2?.agg1 ?? leg1?.agg1 ?? null;
                    const agg2 = leg2?.agg2 ?? leg1?.agg2 ?? null;
                    const winnerId = leg2?.winnerId || leg1?.winnerId;
                    const penLabel = isComplete && (leg2?.penaltyWinnerId || leg1?.penaltyWinnerId) ? '⚡ pens' : '';
                    const l1 = leg1.status === 'completed' ? `L1: ${leg1.score1}–${leg1.score2}` : 'L1: –';
                    const l2 = leg2?.status === 'completed' ? `L2: ${leg2.score1}–${leg2.score2}` : 'L2: –';
                    const aggStr = agg1 !== null ? `Agg ${agg1}–${agg2}` : '';

                    return knockoutRow(
                        leg1.team1Name || 'TBD', aggStr ? agg1 : null,
                        leg1.team2Name || 'TBD', aggStr ? agg2 : null,
                        isComplete,
                        isComplete && winnerId === leg1.team1Id,
                        isComplete && winnerId === leg1.team2Id,
                        [l1, l2, penLabel].filter(Boolean).join(' · ')
                    );
                }).join('')}`;
        }).join('');

        wrapper.innerHTML = `
            ${cardHeader()}
            <div style="padding:14px 0 6px;">
                <div style="font-size:13px;font-weight:700;color:#fff;padding:0 22px 10px;letter-spacing:.5px;">
                    🏆 Knockout Bracket
                </div>
                ${roundsHtml}
            </div>
            ${cardFooter()}`;
    }, 'knockout-bracket.png');
}

function roundLabel(name) {
    return `<div style="
        font-size:11px;font-weight:700;letter-spacing:1.5px;
        color:#FFD700;padding:7px 22px;
        background:rgba(255,215,0,.08);
        border-top:1px solid rgba(255,215,0,.15);
    ">${name.toUpperCase()}</div>`;
}

function knockoutRow(team1, score1, team2, score2, isDone, w1, w2, sub = '') {
    const c1 = w1 ? '#2ECC71' : '#fff';
    const c2 = w2 ? '#2ECC71' : '#fff';
    const scoreDisplay = isDone && score1 !== null
        ? `${score1}  –  ${score2}` : 'vs';

    return `
        <div style="padding:10px 22px;border-bottom:1px solid rgba(255,255,255,.05);">
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="flex:1;font-size:13px;font-weight:700;color:${c1};text-align:right;">${team1}</span>
                <span style="
                    min-width:70px;text-align:center;
                    font-size:${isDone?'15px':'12px'};font-weight:700;
                    color:${isDone?'#FFD700':'#556'};
                    background:rgba(255,215,0,.07);
                    padding:4px 10px;border-radius:6px;
                ">${scoreDisplay}</span>
                <span style="flex:1;font-size:13px;font-weight:700;color:${c2};text-align:left;">${team2}</span>
            </div>
            ${sub ? `<div style="font-size:11px;color:#667;text-align:center;margin-top:5px;">${sub}</div>` : ''}
        </div>`;
}

// ── Download: Champion card ───────────────────────────────────────────────────
async function downloadChampionImage() {
    const champ = state.tournament?.champion;
    if (!champ) { alert('No champion yet.'); return; }

    await captureCard((wrapper) => {
        wrapper.innerHTML = `
            <div style="
                background:linear-gradient(135deg,#001489,#00063a,#001489);
                padding:48px 28px;text-align:center;
                border:2px solid #FFD700;
            ">
                <div style="font-size:56px;margin-bottom:12px;">🏆</div>
                <div style="font-size:12px;letter-spacing:3px;color:#c8d6f5;margin-bottom:10px;text-transform:uppercase;">
                    Champions League EFB Tournament
                </div>
                <div style="font-size:11px;letter-spacing:2px;color:#667;margin-bottom:22px;">
                    CHAMPION
                </div>
                <div style="
                    font-size:32px;font-weight:800;color:#FFD700;
                    text-shadow:0 0 24px rgba(255,215,0,.5);
                    letter-spacing:1px;
                ">${champ}</div>
                <div style="
                    margin-top:24px;font-size:11px;color:#445;letter-spacing:1px;
                ">Admin: 08024348605 · ★ UCL EFB ★</div>
            </div>`;
    }, 'ucl-champion.png');
}

// ── Main render ───────────────────────────────────────────────────────────────
function renderPage() {
    renderStats();
    renderGroups();
    renderKnockoutBracket();
    renderChampion();
}

function renderStats() {
    setEl('teamCount',      state.tournament?.teamsCount || 0);
    setEl('matchCount',     state.matches.length);
    setEl('completedCount', state.matches.filter((m) => m.status === 'completed').length);
    setEl('stageDisplay',   (state.tournament?.currentStage || 'Group').toUpperCase());
}

// ── Groups ────────────────────────────────────────────────────────────────────
function renderGroups() {
    const tabs   = document.getElementById('groupTabs');
    const panels = document.getElementById('groupPanels');
    if (!tabs || !panels) return;

    const groupMatches = state.matches.filter((m) => m.matchType === 'group');
    if (!groupMatches.length) {
        tabs.innerHTML   = '';
        panels.innerHTML = '<p class="empty-state">Groups will appear once the tournament is created.</p>';
        return;
    }

    tabs.innerHTML = GROUP_NAMES.map((g) => {
        const gm       = groupMatches.filter((m) => m.group === g);
        const allDone  = gm.length > 0 && gm.every((m) => m.status === 'completed');
        const someDone = gm.some((m) => m.status === 'completed');
        const cls = allDone ? 'tab-done' : someDone ? 'tab-partial' : '';
        return `<button class="group-tab ${g === state.activeGroup ? 'active' : ''} ${cls}" data-group="${g}">Group ${g}</button>`;
    }).join('');

    const groupTables = state.tournament?.groupTables || {};

    panels.innerHTML = GROUP_NAMES.map((g) => {
        const table    = groupTables[g] || [];
        const fixtures = groupMatches
            .filter((m) => m.group === g)
            .sort((a, b) => a.matchday - b.matchday || a.matchNumber - b.matchNumber);

        const tableRows = table.map((team, i) => {
            const logo = getLogoSrc(team.id);
            return `
                <tr class="team-row ${i < 2 ? 'row-top8' : ''}" data-team-id="${team.id}">
                    <td>${i + 1} ${i < 2 ? '🟢' : ''}</td>
                    <td class="team-cell">
                        <img src="${logo}" alt="${team.name}" class="team-logo-sm" onerror="this.src='assets/logos/default.png'">
                        <span class="team-name-label">${team.name}</span>
                    </td>
                    <td>${team.P}</td><td>${team.W}</td><td>${team.D}</td><td>${team.L}</td>
                    <td>${team.GF}</td><td>${team.GA}</td>
                    <td class="${team.GD > 0 ? 'gd-pos' : team.GD < 0 ? 'gd-neg' : ''}">${team.GD > 0 ? '+' : ''}${team.GD}</td>
                    <td><strong>${team.Pts}</strong></td>
                </tr>`;
        }).join('');

        return `
            <div class="group-panel ${g === state.activeGroup ? 'active' : ''}" data-group="${g}">
                <h3 class="group-heading">Group ${g}</h3>
                <table class="league-table-el">
                    <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>
                    <tbody>${tableRows}</tbody>
                </table>
                <div class="fixtures-list" style="margin-top:16px;">
                    ${fixtures.map(renderFixtureCard).join('')}
                </div>
            </div>`;
    }).join('');

    tabs.querySelectorAll('.group-tab').forEach((tab) => {
        tab.addEventListener('click', () => { state.activeGroup = tab.dataset.group; renderGroups(); });
    });
    panels.querySelectorAll('.team-row').forEach((row) => {
        row.addEventListener('click', () => openTeamModal(row.dataset.teamId));
    });
}

function renderFixtureCard(match) {
    const isDone = match.status === 'completed';
    const score  = isDone ? `${match.score1} – ${match.score2}` : 'vs';
    const badge  = isDone
        ? '<span class="badge badge-done">FT</span>'
        : '<span class="badge badge-pending">Pending</span>';
    return `
        <div class="fixture-card ${isDone ? 'fixture-done' : ''}">
            <div class="fixture-team">
                <img src="${getLogoSrc(match.team1Id)}" alt="${match.team1Name}" class="fixture-logo" onerror="this.src='assets/logos/default.png'">
                <span>${match.team1Name}</span>
            </div>
            <div class="fixture-score"><div class="score-display">${score}</div>${badge}</div>
            <div class="fixture-team fixture-team-right">
                <span>${match.team2Name}</span>
                <img src="${getLogoSrc(match.team2Id)}" alt="${match.team2Name}" class="fixture-logo" onerror="this.src='assets/logos/default.png'">
            </div>
        </div>`;
}

// ── Knockout bracket ──────────────────────────────────────────────────────────
function renderKnockoutBracket() {
    const container = document.getElementById('knockoutBracket');
    if (!container) return;

    const knockoutMatches = state.matches.filter((m) => m.matchType === 'knockout');
    if (!knockoutMatches.length) {
        container.innerHTML = '<p class="empty-state">The knockout bracket appears once all group matches are completed.</p>';
        return;
    }

    const rounds = ['Quarter Finals', 'Semi Finals', 'Final'];

    container.innerHTML = `<div class="bracket">
        ${rounds.map((round) => {
            if (round === 'Final') {
                const finalMatch = knockoutMatches.find((m) => m.round === 'Final');
                if (!finalMatch) return '';
                return `<div class="round"><h3>⭐ Final</h3>${renderFinalMatch(finalMatch)}</div>`;
            }
            const roundMatches = knockoutMatches.filter((m) => m.round === round);
            if (!roundMatches.length) return '';
            const tieIds = [...new Set(roundMatches.map((m) => m.tieId))].sort();
            const tieCards = tieIds.map((tieId) => {
                const leg1 = roundMatches.find((m) => m.tieId === tieId && m.leg === 1);
                const leg2 = roundMatches.find((m) => m.tieId === tieId && m.leg === 2);
                return renderTieCard(leg1, leg2);
            }).join('');
            return `<div class="round"><h3>${round}</h3>${tieCards}</div>`;
        }).join('')}
    </div>`;
}

function renderTieCard(leg1, leg2) {
    if (!leg1) return '';
    const team1Name  = leg1.team1Name || 'TBD';
    const team2Name  = leg1.team2Name || 'TBD';
    const logo1      = getLogoSrc(leg1.team1Id);
    const logo2      = getLogoSrc(leg1.team2Id);
    const tieStatus  = leg2?.tieStatus || leg1?.tieStatus || 'pending';
    const isCompleted = tieStatus === 'completed';
    const agg1 = leg2?.agg1 ?? leg1?.agg1 ?? null;
    const agg2 = leg2?.agg2 ?? leg1?.agg2 ?? null;
    const winnerId   = leg2?.winnerId || leg1?.winnerId || null;
    const winnerName = leg2?.winnerName || leg1?.winnerName || null;
    const penNote    = isCompleted && (leg2?.penaltyWinnerId || leg1?.penaltyWinnerId)
        ? `<div class="pen-note">⚡ Won on Penalties</div>` : '';
    const aggDisplay = (agg1 !== null && agg2 !== null)
        ? `<span class="agg-score">Agg: ${agg1} – ${agg2}</span>` : '';
    const w1 = isCompleted && winnerId === leg1.team1Id;
    const w2 = isCompleted && winnerId === leg1.team2Id;
    const l1Score = leg1.status === 'completed' ? `${leg1.score1}–${leg1.score2}` : '? – ?';
    const l2Score = leg2?.status === 'completed' ? `${leg2.score1}–${leg2.score2}` : '? – ?';

    return `
        <div class="match two-leg-match ${isCompleted ? 'match-done' : ''}">
            <div class="two-leg-teams">
                <div class="team ${w1 ? 'winner' : ''}">
                    <img src="${logo1}" alt="${team1Name}" class="team-logo-sm" onerror="this.src='assets/logos/default.png'">
                    <span>${team1Name}</span>
                </div>
                <div class="team ${w2 ? 'winner' : ''}">
                    <img src="${logo2}" alt="${team2Name}" class="team-logo-sm" onerror="this.src='assets/logos/default.png'">
                    <span>${team2Name}</span>
                </div>
            </div>
            <div class="two-leg-scores">
                <div class="leg-score-row"><span class="leg-label">Leg 1</span><span class="leg-score">${l1Score}</span></div>
                <div class="leg-score-row"><span class="leg-label">Leg 2</span><span class="leg-score">${l2Score}</span></div>
                ${aggDisplay ? `<div class="agg-row">${aggDisplay}</div>` : ''}
            </div>
            ${penNote}
            <div class="match-status">
                ${isCompleted
                    ? `✅ ${winnerName} advance`
                    : tieStatus === 'leg1_done' ? '⏳ Leg 2 pending' : '⏳ Pending'}
            </div>
        </div>`;
}

function renderFinalMatch(match) {
    const isDone = match.status === 'completed';
    const logo1  = getLogoSrc(match.team1Id);
    const logo2  = getLogoSrc(match.team2Id);
    const w1 = isDone && match.winnerId === match.team1Id;
    const w2 = isDone && match.winnerId === match.team2Id;
    const penNote = isDone && match.penaltyWinnerId ? `<div class="pen-note">⚡ Won on Penalties</div>` : '';
    return `
        <div class="match final-match ${isDone ? 'match-done' : ''}">
            <div class="team ${w1 ? 'winner' : ''}">
                <img src="${logo1}" alt="${match.team1Name || 'TBD'}" class="team-logo-sm" onerror="this.src='assets/logos/default.png'">
                <span>${match.team1Name || 'TBD'}</span>
                <strong>${match.score1 !== null ? match.score1 : '-'}</strong>
            </div>
            <div class="team ${w2 ? 'winner' : ''}">
                <img src="${logo2}" alt="${match.team2Name || 'TBD'}" class="team-logo-sm" onerror="this.src='assets/logos/default.png'">
                <span>${match.team2Name || 'TBD'}</span>
                <strong>${match.score2 !== null ? match.score2 : '-'}</strong>
            </div>
            ${penNote}
            <div class="match-status">${isDone ? '🏆 ' + match.winnerName + ' are Champions!' : '⏳ Pending'}</div>
        </div>`;
}

// ── Champion ──────────────────────────────────────────────────────────────────
function renderChampion() {
    const el = document.getElementById('champion');
    if (!el) return;
    const champ = state.tournament?.champion;
    el.textContent = champ || 'No champion yet';
    const logoEl = document.getElementById('championLogo');
    if (logoEl && champ) { logoEl.src = getLogoSrc(state.tournament?.championId); logoEl.style.display = 'block'; }
    else if (logoEl) logoEl.style.display = 'none';
}

// ── Team modal ────────────────────────────────────────────────────────────────
function openTeamModal(teamId) {
    const team = state.teams[teamId];
    if (!team) return;
    const groupTable = (state.tournament?.groupTables || {})[team.group] || [];
    const teamRow    = groupTable.find((t) => t.id === teamId);
    const position   = groupTable.findIndex((t) => t.id === teamId) + 1;

    const teamMatches = state.matches
        .filter((m) => m.matchType === 'group' && (m.team1Id === teamId || m.team2Id === teamId))
        .sort((a, b) => a.matchday - b.matchday);
    const completed = teamMatches.filter((m) => m.status === 'completed');
    const upcoming  = teamMatches.filter((m) => m.status !== 'completed');

    const resultRows = completed.map((m) => {
        const isHome = m.team1Id === teamId;
        const opp = isHome ? m.team2Name : m.team1Name;
        const gf = isHome ? m.score1 : m.score2, ga = isHome ? m.score2 : m.score1;
        const res = gf > ga ? '🟢 W' : gf < ga ? '🔴 L' : '🟡 D';
        return `<div class="modal-result-row">${res} vs ${opp}: ${gf}–${ga} (MD${m.matchday})</div>`;
    }).join('');

    const upcomingRows = upcoming.map((m) => {
        const opp = m.team1Id === teamId ? m.team2Name : m.team1Name;
        return `<div class="modal-upcoming-row">📅 MD${m.matchday}: vs ${opp}</div>`;
    }).join('');

    setEl('modalTeamName', `Group ${team.group} · ${position}. ${team.name}`);
    const logoEl = document.getElementById('modalTeamLogo');
    if (logoEl) {
        logoEl.innerHTML = `<img src="${getLogoSrc(teamId)}" alt="${team.name}"
            onerror="this.outerHTML='<div class=\\'logo-fallback\\'>${team.name.slice(0,2).toUpperCase()}</div>'"
            style="width:80px;height:80px;object-fit:contain;">`;
    }

    setEl('modalTeamStats', `
        <div class="modal-stats-grid">
            <div><strong>Group Pos</strong><span>${position}</span></div>
            <div><strong>Points</strong><span>${teamRow?.Pts ?? 0}</span></div>
            <div><strong>Played</strong><span>${teamRow?.P ?? 0}</span></div>
            <div><strong>Wins</strong><span>${teamRow?.W ?? 0}</span></div>
            <div><strong>Draws</strong><span>${teamRow?.D ?? 0}</span></div>
            <div><strong>Losses</strong><span>${teamRow?.L ?? 0}</span></div>
            <div><strong>GF</strong><span>${teamRow?.GF ?? 0}</span></div>
            <div><strong>GA</strong><span>${teamRow?.GA ?? 0}</span></div>
            <div><strong>GD</strong><span>${(teamRow?.GD ?? 0) >= 0 ? '+' : ''}${teamRow?.GD ?? 0}</span></div>
        </div>
        ${completed.length ? `<h4 style="margin:14px 0 8px;color:var(--primary);">Results</h4>${resultRows}` : ''}
        ${upcoming.length  ? `<h4 style="margin:14px 0 8px;color:var(--gold);">Upcoming</h4>${upcomingRows}` : ''}
    `);

    document.getElementById('teamModal').style.display = 'flex';
}

function setupModalEvents() {
    const modal = document.getElementById('teamModal');
    const close = document.getElementById('teamModalClose');
    if (!modal || !close) return;
    close.addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
}

// ── Utility ───────────────────────────────────────────────────────────────────
function getLogoSrc(teamId) {
    if (!teamId) return 'assets/logos/default.png';
    return state.teams[teamId]?.logo || `assets/logos/${teamId}.png`;
}
function setEl(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
