/**
 * The Narrator — a cryo-pod diagnostic AI running cognitive and motor tests
 * to determine if the subject is cleared for release. Clinical veneer over
 * a dry personality. Addresses player as "Subject" or "Operator."
 *
 * Premise: You just woke up from cryosleep. These microgames are your
 * reactivation diagnostics. The AI decides if you're fit to leave the pod.
 */

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- Opening (shown once when entering microgame mode) ---

export const OPENING_LINES = [
  "Cryogenic revival sequence initiated.\nBeginning cognitive assessment.",
  "Subject vitals detected. Neural activity... present.\nCommencing motor function diagnostics.",
  "Welcome back, Operator.\nPlease complete the following assessment for pod release clearance.",
  "Revival protocol active. You've been under for... a while.\nLet's see if everything still works.",
];

// --- Win reactions ---

const WIN_FIRST = [
  "Motor response within acceptable range.",
  "Neural pathway confirmed functional.",
  "Response logged. Cognitive baseline established.",
  "Adequate. Cryodamage assessment: minimal.",
  "Correct. That's one system checked.",
];

const WIN_STREAK_2 = [
  "Consecutive pass. Synaptic recovery trending positive.",
  "Again. Noted. Updating your file.",
  "Two for two. The thawing process appears successful.",
  "Reflexes online. Encouraging.",
  "Repeat success. Reducing atrophy probability estimate.",
];

const WIN_STREAK_3 = [
  "Three consecutive. Beginning to consider release clearance.",
  "Sustained performance detected. Unusual for your thaw cycle.",
  "Pod release protocols... warming up. Metaphorically.",
  "The pod is reconsidering its opinion of you.",
  "Neural plasticity exceeding projections. Interesting.",
];

const WIN_STREAK_HIGH = [
  "At this rate I'll have to let you out. Reluctantly.",
  "Performance exceeds 94th percentile for revival subjects.",
  "You're making other thaw patients look bad.",
  "I'm running out of tests. You're running out of excuses to stay.",
  "Pod release clearance at... look, you're fine. Probably.",
  "Exceptional recovery. Your cryo-pod warranty is void either way.",
];

// --- Lose reactions ---

const LOSE_FIRST = [
  "Response lag detected. Common post-cryo symptom.",
  "Miss. Adjusting for neural thaw delay.",
  "Suboptimal. The cryogel may still be wearing off.",
  "Reaction failure noted. Pod re-entry remains an option.",
  "Incorrect. Don't worry. Most subjects struggle initially.",
];

const LOSE_STREAK_2 = [
  "Second miss. Scheduling extended observation.",
  "Consecutive failure. Are you sure you're awake?",
  "Two lapses. The pod is getting warmer for your return.",
  "Repeat failure logged. Cognitive recovery: uncertain.",
  "Again. Perhaps more thaw time is needed.",
];

const LOSE_STREAK_3 = [
  "Three failures. Recommending supplemental cryogel flush.",
  "Extended cognitive delay detected. Pod re-entry under review.",
  "Your motor functions are... let's call them 'developing.'",
  "At this rate, the pod's release latch may rust first.",
  "Triple miss. I've seen faster recovery from deeper freezes.",
];

const LOSE_STREAK_HIGH = [
  "Sustained failure pattern. Re-freeze authorization at 80%.",
  "Should I prep the pod for re-entry? That wasn't rhetorical.",
  "The cryogel has feelings and even it's disappointed.",
  "Diagnostic conclusion: you may need another century of sleep.",
  "I'm legally required to offer you a blanket and a longer nap.",
];

// --- Round intro quips ---

const INTRO_EARLY = [
  "Standard motor diagnostic.",
  "Beginning neural response test.",
  "Basic cognitive calibration.",
  "Reflex assessment. Standard procedure.",
  "Next diagnostic. Try to focus.",
  "Routine evaluation. Should be simple.",
];

const INTRO_MID = [
  "Advancing to intermediate diagnostics.",
  "Increasing stimulus complexity.",
  "This one separates the thawed from the frozen.",
  "Your neural pathways should be warm enough for this.",
  "Mid-tier assessment. The easy part is over.",
  "Elevating difficulty. Your vitals can handle it. Probably.",
];

const INTRO_LATE = [
  "Advanced diagnostics. Most subjects don't reach this stage.",
  "Deep cognitive assessment. Your pod is impressed.",
  "Final-tier evaluation. Almost free.",
  "This test was reserved for exceptional recovery cases.",
  "Nearing release threshold. Don't falter now.",
  "Last battery of tests. The exit hatch is right there.",
];

// --- Speed-up ---

const SPEED_UP = [
  "Accelerating diagnostics. Your thaw window is limited.",
  "Speed increase authorized. The pod doesn't wait forever.",
  "Faster now. Simulating real-world response demands.",
  "Reaction time threshold raised. Adapt or re-freeze.",
  "Increasing tempo. Consider it... encouragement.",
  "Time compression active. Welcome to the deep end.",
];

// --- Last life ---

const LAST_LIFE = [
  "Final assessment chance. Re-freeze protocol on standby.",
  "One attempt remaining. The pod is pre-warming.",
  "Last chance before mandatory re-cryogenization.",
  "Critical threshold. Next failure triggers re-entry.",
];

// --- Game over ---

const GAMEOVER_LOW = [ // 0-3
  "Assessment failed. Initiating re-freeze sequence.\nYou'll try again in... well, eventually.",
  "Cognitive recovery: insufficient.\nRecommending extended cryogenic rest.",
  "Test concluded. Subject not cleared for release.\nPod will maintain life support. You're welcome.",
  "Diagnostic result: not ready.\nDon't take it personally. The pod is very comfortable.",
];

const GAMEOVER_MID = [ // 4-8
  "Partial clearance. You're alive, but are you awake?\nFurther monitoring recommended.",
  "Mixed results. You're technically functional.\nThe 'technically' is doing heavy lifting there.",
  "Assessment: borderline viable.\nI'll file this as 'needs work' rather than 're-freeze.'",
  "You showed promise. Briefly.\nPod release: pending review.",
];

const GAMEOVER_HIGH = [ // 9-14
  "Near-full cognitive recovery detected.\nPod release clearance: approved. Provisionally.",
  "Strong performance. You're almost a real person again.\nThe airlock is to your left.",
  "Assessment passed. I'm genuinely surprised.\nYour personal effects are in locker 7.",
  "Diagnostic complete. Neural recovery: excellent.\nYou're cleared. Try not to need us again.",
];

const GAMEOVER_EXCEPTIONAL = [ // 15+
  "Perfect cognitive recovery. This shouldn't be possible.\nYou're either exceptional or the test is broken.",
  "Full clearance. Pod release authorized immediately.\nThe system has... no further notes.",
  "Assessment complete. Subject exceeds all thaw benchmarks.\nWelcome back, Operator. You've been missed.",
  "Flawless recovery from cryogenic suspension.\nI'm adding your results to the 'anomalies' file.",
];

export class Narrator {
  private winStreak = 0;
  private loseStreak = 0;

  reset(): void {
    this.winStreak = 0;
    this.loseStreak = 0;
  }

  getOpening(): string {
    return pick(OPENING_LINES);
  }

  getIntro(round: number): string {
    if (round <= 3) return pick(INTRO_EARLY);
    if (round <= 8) return pick(INTRO_MID);
    return pick(INTRO_LATE);
  }

  getWinReaction(): string {
    this.winStreak++;
    this.loseStreak = 0;
    if (this.winStreak >= 5) return pick(WIN_STREAK_HIGH);
    if (this.winStreak >= 3) return pick(WIN_STREAK_3);
    if (this.winStreak >= 2) return pick(WIN_STREAK_2);
    return pick(WIN_FIRST);
  }

  getLoseReaction(): string {
    this.loseStreak++;
    this.winStreak = 0;
    if (this.loseStreak >= 5) return pick(LOSE_STREAK_HIGH);
    if (this.loseStreak >= 3) return pick(LOSE_STREAK_3);
    if (this.loseStreak >= 2) return pick(LOSE_STREAK_2);
    return pick(LOSE_FIRST);
  }

  getSpeedUp(): string {
    return pick(SPEED_UP);
  }

  getLastLife(): string {
    return pick(LAST_LIFE);
  }

  getGameOver(score: number): string {
    if (score >= 15) return pick(GAMEOVER_EXCEPTIONAL);
    if (score >= 9) return pick(GAMEOVER_HIGH);
    if (score >= 4) return pick(GAMEOVER_MID);
    return pick(GAMEOVER_LOW);
  }
}
