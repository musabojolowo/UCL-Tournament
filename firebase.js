/**
 * firebase.js — Champions League Tournament
 * 16 teams · 4 Groups (A–D) of 4 · Double round-robin within group (home & away)
 * Top 2 per group → Quarter Finals (8 teams) → Semi Finals → Final
 * Knockout: TWO LEGS (aggregate) for QF & SF, Final: single leg
 * If aggregate level after Leg 2 → penalty winner required
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
    getDatabase, ref, update, set, get, remove, onValue
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js';
import {
    getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';

// ── Firebase config ───────────────────────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyBJ2e0QNkh0DwZb9gdV0m6kLvM50hAqn20",
    authDomain: "ucl-tournament-c1839.firebaseapp.com",
    databaseURL: "https://ucl-tournament-c1839-default-rtdb.firebaseio.com",
    projectId: "ucl-tournament-c1839",
    storageBucket: "ucl-tournament-c1839.firebasestorage.app",
    messagingSenderId: "791066670937",
    appId: "1:791066670937:web:0014c7b287377e9e2bfe48"
};

const app  = initializeApp(firebaseConfig);
const db   = getDatabase(app);
const auth = getAuth(app);

// ── Constants ─────────────────────────────────────────────────────────────────
const COLLECTIONS  = { TOURNAMENT: 'tournament', MATCHES: 'matches', TEAMS: 'teams' };
const TOURNAMENT_ID = 'ucl-main';
const GROUP_NAMES   = ['A', 'B', 'C', 'D'];

// Knockout rounds that use TWO legs (Final is always single leg)
const TWO_LEG_ROUNDS = ['Quarter Finals', 'Semi Finals'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitizeTeamId(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function createTeamObject(name, group) {
    const id = sanitizeTeamId(name);
    return { id, name, group, logo: `assets/logos/${id}.png` };
}

function createStatObj(id, name, group) {
    return { id, name, group, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, GD: 0, Pts: 0 };
}

function formatScore(value) {
    return value === null ? null : Number(value);
}

function sortTable(table) {
    return table.sort((a, b) => {
        if (b.Pts !== a.Pts) return b.Pts - a.Pts;
        if (b.GD  !== a.GD)  return b.GD  - a.GD;
        if (b.GF  !== a.GF)  return b.GF  - a.GF;
        return a.name.localeCompare(b.name);
    });
}

function createGroupMatchObject(group, matchday, matchNumber, team1, team2) {
    const now = new Date().toISOString();
    return {
        id: `group-${group}-${matchday}-${matchNumber}`,
        round: `Group ${group}`, matchType: 'group',
        group, matchday, matchNumber,
        team1Id: team1.id, team1Name: team1.name, team1Logo: team1.logo,
        team2Id: team2.id, team2Name: team2.name, team2Logo: team2.logo,
        score1: null, score2: null,
        winnerId: null, winnerName: null,
        status: 'pending', scheduledAt: null,
        createdAt: now, updatedAt: now
    };
}

/**
 * Double round-robin fixtures for a group of 4 teams.
 * Leg 1 (matchdays 1–3): standard single round-robin (circle method).
 * Leg 2 (matchdays 4–6): same pairings, home/away reversed.
 * Result: 3 matchdays × 2 matches = 6 matches per leg → 12 matches per group,
 * 6 matches per team (3 opponents × 2 legs). 4 groups → 48 total matches.
 */
function generateGroupFixtures(group, teamObjects) {
    const teams    = [...teamObjects];
    const n        = teams.length;       // 4
    const rounds   = n - 1;               // 3
    const half     = n / 2;               // 2
    const rotation = teams.slice(1);
    const schedule = [];

    // Leg 1 — matchdays 1..rounds
    for (let round = 1; round <= rounds; round++) {
        const opponents = [teams[0], ...rotation];
        for (let i = 0; i < half; i++) {
            schedule.push(createGroupMatchObject(group, round, i + 1, opponents[i], opponents[n - 1 - i]));
        }
        rotation.unshift(rotation.pop());
    }

    // Leg 2 — matchdays rounds+1..rounds*2, same pairings with sides swapped
    const leg1Matches = [...schedule];
    for (let round = 1; round <= rounds; round++) {
        const matchesThisRound = leg1Matches.filter((m) => m.matchday === round);
        matchesThisRound.forEach((m, i) => {
            const homeReturn = { id: m.team2Id, name: m.team2Name, logo: m.team2Logo };
            const awayReturn = { id: m.team1Id, name: m.team1Name, logo: m.team1Logo };
            schedule.push(createGroupMatchObject(group, round + rounds, i + 1, homeReturn, awayReturn));
        });
    }

    return schedule;
}

// ── Two-leg tie object ────────────────────────────────────────────────────────
/**
 * A "tie" groups Leg 1 + Leg 2 into one logical unit.
 * tieId:    e.g. "quarter-finals-tie-1"
 * leg1Id:   e.g. "quarter-finals-tie-1-leg1"
 * leg2Id:   e.g. "quarter-finals-tie-1-leg2"
 *
 * team1 plays at HOME in Leg 1, AWAY in Leg 2.
 * team2 plays AWAY in Leg 1, HOME in Leg 2.
 *
 * Aggregate is always expressed as team1Agg – team2Agg
 * (team1 goals across both legs vs team2 goals across both legs).
 */
function createTiePair(round, tieNumber, team1, team2, nextRound, nextMatchSlot, nextSlotIndex) {
    const now   = new Date().toISOString();
    const tieId = `${slugRound(round)}-tie-${tieNumber}`;

    const base = {
        round, matchType: 'knockout',
        tieId, tieNumber,
        team1Id: team1?.id   || null, team1Name: team1?.name || null, team1Logo: team1?.logo || null,
        team2Id: team2?.id   || null, team2Name: team2?.name || null, team2Logo: team2?.logo || null,
        // Aggregate / result fields (filled after Leg 2)
        agg1: null, agg2: null,
        winnerId: null, winnerName: null,
        penaltyWinnerId: null, penaltyWinnerName: null,
        tieStatus: 'pending',       // 'pending' | 'leg1_done' | 'completed'
        nextRound, nextMatchSlot, nextSlotIndex,
        isFinal: false,
        createdAt: now, updatedAt: now
    };

    const leg1 = {
        ...base,
        id: `${tieId}-leg1`, leg: 1,
        // team1 = home in Leg 1, team2 = away
        score1: null, score2: null,
        status: 'pending'
    };

    const leg2 = {
        ...base,
        id: `${tieId}-leg2`, leg: 2,
        // teams SWAP sides: team1 is now away (but we keep team1/team2 IDs consistent)
        score1: null, score2: null,
        status: 'pending'
    };

    return { tieId, leg1, leg2 };
}

/** Create a single-leg Final match object */
function createFinalMatch(team1, team2) {
    const now = new Date().toISOString();
    return {
        id: 'final-1', tieId: 'final-1', leg: 1,
        round: 'Final', matchType: 'knockout',
        isFinal: true, tieNumber: 1, tieStatus: 'pending',
        team1Id: team1?.id || null, team1Name: team1?.name || null, team1Logo: team1?.logo || null,
        team2Id: team2?.id || null, team2Name: team2?.name || null, team2Logo: team2?.logo || null,
        score1: null, score2: null,
        agg1: null, agg2: null,
        winnerId: null, winnerName: null,
        penaltyWinnerId: null, penaltyWinnerName: null,
        nextRound: null, nextMatchSlot: null, nextSlotIndex: null,
        status: 'pending',
        createdAt: now, updatedAt: now
    };
}

function slugRound(round) {
    return round.toLowerCase().replace(/\s+/g, '-');
}

// ── Tournament initialisation ─────────────────────────────────────────────────

async function initializeTournament(teamsByGroup, countdownDate = null) {
    const groupKeys = Object.keys(teamsByGroup);
    if (groupKeys.length !== 4) throw new Error('Exactly 4 groups (A–D) required.');
    for (const g of groupKeys) {
        if (!Array.isArray(teamsByGroup[g]) || teamsByGroup[g].length !== 4)
            throw new Error(`Group ${g} must have exactly 4 teams.`);
    }

    const now = new Date().toISOString();
    const updates = {};

    GROUP_NAMES.forEach((group) => {
        const teamObjs = teamsByGroup[group].map((n) => createTeamObject(n, group));
        teamObjs.forEach((t) => { updates[`${COLLECTIONS.TEAMS}/${t.id}`] = t; });
        generateGroupFixtures(group, teamObjs).forEach((m) => { updates[`${COLLECTIONS.MATCHES}/${m.id}`] = m; });
    });

    updates[`${COLLECTIONS.TOURNAMENT}/${TOURNAMENT_ID}`] = {
        name: 'Champions League Tournament', teamsCount: 16,
        groups: GROUP_NAMES, champion: null, championId: null,
        status: 'group', currentStage: 'group', knockoutStage: null,
        countdownDate: countdownDate ? countdownDate.toISOString() : now,
        createdAt: now, updatedAt: now, qualifiers: []
    };

    await update(ref(db), updates);
    await updateGroupTables();
    return { success: true };
}

// ── Real-time listeners ───────────────────────────────────────────────────────

function onMatchesUpdate(cb) {
    return onValue(ref(db, COLLECTIONS.MATCHES), (s) => cb(Object.values(s.val() || {})));
}
function onTournamentUpdate(cb) {
    return onValue(ref(db, `${COLLECTIONS.TOURNAMENT}/${TOURNAMENT_ID}`), (s) => cb(s.val() || {}));
}
function onTeamsUpdate(cb) {
    return onValue(ref(db, COLLECTIONS.TEAMS), (s) => cb(s.val() || {}));
}

async function getTeams() {
    return (await get(ref(db, COLLECTIONS.TEAMS))).val() || {};
}
async function getAllMatches() {
    return Object.values((await get(ref(db, COLLECTIONS.MATCHES))).val() || {});
}

// ── Group table recalculation ─────────────────────────────────────────────────

async function updateGroupTables() {
    const teams      = await getTeams();
    const allMatches = await getAllMatches();
    const groupMatches = allMatches.filter((m) => m.matchType === 'group');

    const statsMap = {};
    Object.values(teams).forEach((t) => { statsMap[t.id] = createStatObj(t.id, t.name, t.group); });

    groupMatches.forEach((match) => {
        if (match.status !== 'completed' || match.score1 === null) return;
        const home = statsMap[match.team1Id], away = statsMap[match.team2Id];
        if (!home || !away) return;
        const s1 = Number(match.score1), s2 = Number(match.score2);
        home.P++; away.P++;
        home.GF += s1; home.GA += s2;
        away.GF += s2; away.GA += s1;
        if (s1 > s2)      { home.W++; away.L++; home.Pts += 3; }
        else if (s2 > s1) { away.W++; home.L++; away.Pts += 3; }
        else              { home.D++; away.D++; home.Pts++; away.Pts++; }
    });

    Object.values(statsMap).forEach((t) => { t.GD = t.GF - t.GA; });

    const groupTables = {};
    GROUP_NAMES.forEach((g) => {
        groupTables[g] = sortTable(Object.values(statsMap).filter((t) => t.group === g));
    });

    const allGroupDone = groupMatches.length > 0 && groupMatches.every((m) => m.status === 'completed');
    let qualifiers = [];
    if (allGroupDone) {
        GROUP_NAMES.forEach((g) => {
            groupTables[g].slice(0, 2).forEach((t, i) => qualifiers.push({ ...t, groupPosition: i + 1 }));
        });
        qualifiers = sortTable(qualifiers);
    }

    await update(ref(db, `${COLLECTIONS.TOURNAMENT}/${TOURNAMENT_ID}`), {
        groupTables, qualifiers, updatedAt: new Date().toISOString()
    });

    return { groupTables, qualifiers };
}

// ── Knockout stage ────────────────────────────────────────────────────────────

async function startKnockoutStage() {
    const tSnap = await get(ref(db, `${COLLECTIONS.TOURNAMENT}/${TOURNAMENT_ID}`));
    const tournament = tSnap.val();
    if (!tournament) throw new Error('Tournament not found.');

    const allMatches   = await getAllMatches();
    const groupMatches = allMatches.filter((m) => m.matchType === 'group');
    const completed    = groupMatches.filter((m) => m.status === 'completed').length;
    if (completed < groupMatches.length)
        throw new Error(`All group matches must be completed first (${completed}/${groupMatches.length} done).`);

    // Idempotent
    if (allMatches.some((m) => m.matchType === 'knockout' && m.round === 'Quarter Finals'))
        return { success: true };

    let qualifiers = tournament.qualifiers;
    if (!qualifiers || qualifiers.length !== 8) qualifiers = (await updateGroupTables()).qualifiers;
    if (!qualifiers || qualifiers.length !== 8) throw new Error('Unable to determine 8 qualifiers.');

    // Seeded pairs: 1v8, 2v7, 3v6, 4v5
    const updates = {};
    const now     = new Date().toISOString();

    for (let i = 0; i < 4; i++) {
        const team1 = qualifiers[i];
        const team2 = qualifiers[7 - i];
        const tieNumber  = i + 1;
        const sfSlot      = Math.floor(i / 2) + 1;   // ties 1,2→SF1 | 3,4→SF2
        const sfTeamIndex = i % 2;

        const { leg1, leg2 } = createTiePair(
            'Quarter Finals', tieNumber, team1, team2,
            'Semi Finals', sfSlot, sfTeamIndex
        );
        updates[`${COLLECTIONS.MATCHES}/${leg1.id}`] = leg1;
        updates[`${COLLECTIONS.MATCHES}/${leg2.id}`] = leg2;
    }

    // Semi-final placeholders (2 ties, 2 legs each)
    for (let i = 1; i <= 2; i++) {
        const { leg1, leg2 } = createTiePair('Semi Finals', i, null, null, 'Final', 1, i - 1);
        updates[`${COLLECTIONS.MATCHES}/${leg1.id}`] = leg1;
        updates[`${COLLECTIONS.MATCHES}/${leg2.id}`] = leg2;
    }

    // Final — single leg
    updates[`${COLLECTIONS.MATCHES}/final-1`] = createFinalMatch(null, null);

    updates[`${COLLECTIONS.TOURNAMENT}/${TOURNAMENT_ID}/status`]        = 'knockout';
    updates[`${COLLECTIONS.TOURNAMENT}/${TOURNAMENT_ID}/currentStage`]  = 'knockout';
    updates[`${COLLECTIONS.TOURNAMENT}/${TOURNAMENT_ID}/knockoutStage`] = 'Quarter Finals';
    updates[`${COLLECTIONS.TOURNAMENT}/${TOURNAMENT_ID}/updatedAt`]     = now;

    await update(ref(db), updates);
    return { success: true };
}

// ── Advance winner to next round ──────────────────────────────────────────────

async function advanceWinner(match, winner) {
    if (!match.nextRound) return;

    if (match.nextRound === 'Final') {
        // Fill in Final slot
        const finalRef = ref(db, `${COLLECTIONS.MATCHES}/final-1`);
        const snap     = await get(finalRef);
        const final    = snap.val() || {};
        const slotIndex = match.nextSlotIndex;
        const payload   = {};
        if (slotIndex === 0) {
            payload.team1Id   = winner.id; payload.team1Name = winner.name;
            payload.team1Logo = winner.logo || `assets/logos/${winner.id}.png`;
        } else {
            payload.team2Id   = winner.id; payload.team2Name = winner.name;
            payload.team2Logo = winner.logo || `assets/logos/${winner.id}.png`;
        }
        payload.updatedAt = new Date().toISOString();
        await update(finalRef, payload);
        return;
    }

    // Two-leg next round: fill both leg1 & leg2
    const slug      = slugRound(match.nextRound);
    const tieSlot   = match.nextMatchSlot;
    const slotIndex = match.nextSlotIndex;
    const leg1Ref   = ref(db, `${COLLECTIONS.MATCHES}/${slug}-tie-${tieSlot}-leg1`);
    const leg2Ref   = ref(db, `${COLLECTIONS.MATCHES}/${slug}-tie-${tieSlot}-leg2`);

    const payload = {};
    if (slotIndex === 0) {
        payload.team1Id = winner.id; payload.team1Name = winner.name;
        payload.team1Logo = winner.logo || `assets/logos/${winner.id}.png`;
    } else {
        payload.team2Id = winner.id; payload.team2Name = winner.name;
        payload.team2Logo = winner.logo || `assets/logos/${winner.id}.png`;
    }
    payload.updatedAt = new Date().toISOString();
    await update(leg1Ref, payload);
    await update(leg2Ref, payload);
}

// ── Result submission ─────────────────────────────────────────────────────────

/**
 * Submit a match result.
 *
 * GROUP matches: just enter score — draws fine.
 *
 * KNOCKOUT legs:
 *   - Leg 1: save score, mark leg1 done, update tieStatus = 'leg1_done'.
 *   - Leg 2: save score, compute aggregate, determine winner.
 *     If aggregate level → need penaltyWinnerId/Name.
 *
 * FINAL (single leg): same as a normal knockout match, penalties if level.
 */
async function submitMatchResult(matchId, score1, score2, penaltyWinnerId = null, penaltyWinnerName = null) {
    const matchRef = ref(db, `${COLLECTIONS.MATCHES}/${matchId}`);
    const snap     = await get(matchRef);
    if (!snap.exists()) throw new Error('Match not found');
    const match = snap.val();
    const now   = new Date().toISOString();
    const s1 = formatScore(score1), s2 = formatScore(score2);

    // ── Group match ───────────────────────────────────────────────────────────
    if (match.matchType === 'group') {
        const winnerId   = s1 > s2 ? match.team1Id   : s2 > s1 ? match.team2Id   : null;
        const winnerName = s1 > s2 ? match.team1Name : s2 > s1 ? match.team2Name : null;
        await update(matchRef, { score1: s1, score2: s2, winnerId, winnerName, status: 'completed', updatedAt: now });
        await updateGroupTables();

        const allMatches   = await getAllMatches();
        const groupMatches = allMatches.filter((m) => m.matchType === 'group');
        if (groupMatches.every((m) => m.status === 'completed')) await startKnockoutStage();
        return { success: true };
    }

    // ── Final (single leg) ────────────────────────────────────────────────────
    if (match.isFinal) {
        let winnerId, winnerName;
        if (s1 === s2) {
            if (!penaltyWinnerId) throw new Error('Final is level after Extra Time. Please supply the penalty winner.');
            winnerId = penaltyWinnerId; winnerName = penaltyWinnerName;
        } else {
            winnerId   = s1 > s2 ? match.team1Id   : match.team2Id;
            winnerName = s1 > s2 ? match.team1Name : match.team2Name;
        }
        await update(matchRef, {
            score1: s1, score2: s2, agg1: s1, agg2: s2,
            penaltyWinnerId: s1 === s2 ? penaltyWinnerId : null,
            penaltyWinnerName: s1 === s2 ? penaltyWinnerName : null,
            winnerId, winnerName,
            status: 'completed', tieStatus: 'completed', updatedAt: now
        });
        await update(ref(db, `${COLLECTIONS.TOURNAMENT}/${TOURNAMENT_ID}`), {
            champion: winnerName, championId: winnerId,
            status: 'completed', currentStage: 'completed', updatedAt: now
        });
        return { success: true };
    }

    // ── Two-leg knockout ──────────────────────────────────────────────────────
    const { tieId, leg } = match;

    if (leg === 1) {
        // Save Leg 1, update tieStatus on both legs
        await update(matchRef, { score1: s1, score2: s2, status: 'completed', tieStatus: 'leg1_done', updatedAt: now });

        // Update Leg 2 tieStatus so the UI knows Leg 1 is done
        const leg2Ref = ref(db, `${COLLECTIONS.MATCHES}/${tieId}-leg2`);
        await update(leg2Ref, { tieStatus: 'leg1_done', updatedAt: now });

        return { success: true, leg: 1 };
    }

    if (leg === 2) {
        // Fetch Leg 1 result
        const leg1Snap = await get(ref(db, `${COLLECTIONS.MATCHES}/${tieId}-leg1`));
        if (!leg1Snap.exists()) throw new Error('Leg 1 must be submitted before Leg 2.');
        const leg1 = leg1Snap.val();
        if (leg1.status !== 'completed') throw new Error('Leg 1 must be completed before submitting Leg 2.');

        // Aggregate: team1's total goals vs team2's total goals across both legs
        const agg1 = Number(leg1.score1) + s1;   // team1 scored in L1 home + L2 away
        const agg2 = Number(leg1.score2) + s2;   // team2 scored in L1 away + L2 home

        let winnerId, winnerName;

        if (agg1 !== agg2) {
            winnerId   = agg1 > agg2 ? match.team1Id   : match.team2Id;
            winnerName = agg1 > agg2 ? match.team1Name : match.team2Name;
        } else {
            // Aggregate level → penalties
            if (!penaltyWinnerId) {
                throw new Error(`Aggregate is level (${agg1}–${agg2}). Please supply the penalty shoot-out winner.`);
            }
            winnerId = penaltyWinnerId; winnerName = penaltyWinnerName;
        }

        const now2 = new Date().toISOString();

        // Save Leg 2
        await update(matchRef, {
            score1: s1, score2: s2,
            agg1, agg2,
            penaltyWinnerId: agg1 === agg2 ? penaltyWinnerId : null,
            penaltyWinnerName: agg1 === agg2 ? penaltyWinnerName : null,
            winnerId, winnerName,
            status: 'completed', tieStatus: 'completed', updatedAt: now2
        });

        // Propagate aggregate + winner back to Leg 1 for display
        await update(ref(db, `${COLLECTIONS.MATCHES}/${tieId}-leg1`), {
            agg1, agg2, winnerId, winnerName,
            tieStatus: 'completed', updatedAt: now2
        });

        // Advance winner
        const winner = {
            id:   winnerId,
            name: winnerName,
            logo: winnerId === match.team1Id ? match.team1Logo : match.team2Logo
        };
        await advanceWinner(match, winner);

        return { success: true, leg: 2, agg1, agg2, winnerId };
    }

    throw new Error('Unknown leg number: ' + leg);
}

// ── Clear a result ────────────────────────────────────────────────────────────

async function clearMatchResult(matchId) {
    const matchRef = ref(db, `${COLLECTIONS.MATCHES}/${matchId}`);
    const snap     = await get(matchRef);
    if (!snap.exists()) throw new Error('Match not found');
    const match = snap.val();
    const now   = new Date().toISOString();

    if (match.matchType === 'group') {
        await update(matchRef, { score1: null, score2: null, winnerId: null, winnerName: null, status: 'pending', updatedAt: now });
        await updateGroupTables();
        return { success: true };
    }

    if (match.isFinal) {
        await update(matchRef, {
            score1: null, score2: null, agg1: null, agg2: null,
            winnerId: null, winnerName: null,
            penaltyWinnerId: null, penaltyWinnerName: null,
            status: 'pending', tieStatus: 'pending', updatedAt: now
        });
        const tSnap = await get(ref(db, `${COLLECTIONS.TOURNAMENT}/${TOURNAMENT_ID}`));
        const t = tSnap.val();
        if (t?.champion === match.winnerName) {
            await update(ref(db, `${COLLECTIONS.TOURNAMENT}/${TOURNAMENT_ID}`), {
                champion: null, championId: null, status: 'knockout', currentStage: 'knockout', updatedAt: now
            });
        }
        return { success: true };
    }

    // Two-leg knockout
    const { tieId, leg } = match;

    if (leg === 2 && match.status === 'completed') {
        // Clear aggregate from both legs, remove winner advancement
        await update(matchRef, {
            score1: null, score2: null, agg1: null, agg2: null,
            winnerId: null, winnerName: null,
            penaltyWinnerId: null, penaltyWinnerName: null,
            status: 'pending', tieStatus: 'leg1_done', updatedAt: now
        });
        // Revert Leg 1 aggregate
        await update(ref(db, `${COLLECTIONS.MATCHES}/${tieId}-leg1`), {
            agg1: null, agg2: null, winnerId: null, winnerName: null,
            tieStatus: 'leg1_done', updatedAt: now
        });
        // Clear the winner from next round
        await clearAdvancement(match);
    } else if (leg === 1) {
        await update(matchRef, {
            score1: null, score2: null, status: 'pending', tieStatus: 'pending', updatedAt: now
        });
        await update(ref(db, `${COLLECTIONS.MATCHES}/${tieId}-leg2`), { tieStatus: 'pending', updatedAt: now });
    }

    return { success: true };
}

async function clearAdvancement(match) {
    if (!match.winnerId || !match.nextRound) return;
    const now = new Date().toISOString();

    if (match.nextRound === 'Final') {
        const finalRef = ref(db, `${COLLECTIONS.MATCHES}/final-1`);
        const snap = await get(finalRef);
        if (!snap.exists()) return;
        const final = snap.val();
        const slotIndex = match.nextSlotIndex;
        const payload = {};
        const fieldId   = slotIndex === 0 ? 'team1Id'   : 'team2Id';
        const fieldName = slotIndex === 0 ? 'team1Name' : 'team2Name';
        const fieldLogo = slotIndex === 0 ? 'team1Logo' : 'team2Logo';
        if (final[fieldId] === match.winnerId) {
            payload[fieldId] = null; payload[fieldName] = null; payload[fieldLogo] = null;
            payload.updatedAt = now;
            await update(finalRef, payload);
        }
        return;
    }

    const slug    = slugRound(match.nextRound);
    const tieSlot = match.nextMatchSlot;
    const slotIdx = match.nextSlotIndex;
    const fieldId   = slotIdx === 0 ? 'team1Id'   : 'team2Id';
    const fieldName = slotIdx === 0 ? 'team1Name' : 'team2Name';
    const fieldLogo = slotIdx === 0 ? 'team1Logo' : 'team2Logo';

    for (const legNum of [1, 2]) {
        const legRef = ref(db, `${COLLECTIONS.MATCHES}/${slug}-tie-${tieSlot}-leg${legNum}`);
        const snap   = await get(legRef);
        if (snap.exists() && snap.val()[fieldId] === match.winnerId) {
            await update(legRef, { [fieldId]: null, [fieldName]: null, [fieldLogo]: null, updatedAt: now });
        }
    }
}

// ── Full reset ────────────────────────────────────────────────────────────────

async function resetTournament() {
    await remove(ref(db, COLLECTIONS.MATCHES));
    await remove(ref(db, COLLECTIONS.TEAMS));
    await set(ref(db, `${COLLECTIONS.TOURNAMENT}/${TOURNAMENT_ID}`), {
        name: 'Champions League Tournament', teamsCount: 0,
        groups: GROUP_NAMES, champion: null, championId: null,
        status: 'reset', currentStage: 'setup', knockoutStage: null,
        countdownDate: new Date().toISOString(),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        qualifiers: []
    });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function loginAdmin(email, password) { return signInWithEmailAndPassword(auth, email, password); }
async function logoutAdmin() { return signOut(auth); }
function getCurrentUser() { return new Promise((r) => onAuthStateChanged(auth, (u) => r(u))); }

// ── Exports ───────────────────────────────────────────────────────────────────

export {
    db, auth, GROUP_NAMES, TWO_LEG_ROUNDS,
    initializeTournament,
    onMatchesUpdate, onTournamentUpdate, onTeamsUpdate,
    submitMatchResult, clearMatchResult,
    startKnockoutStage, updateGroupTables, resetTournament,
    loginAdmin, logoutAdmin, getCurrentUser, onAuthStateChanged
};
