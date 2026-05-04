/**
 * Patient personas for offline eval. Each persona is a lightweight stateful
 * script: given the agent's current question, it returns a plausible reply.
 *
 * The replies are intentionally not always perfectly direct — real patients
 * volunteer detail unevenly. The eval is a regression check that the agent:
 *  (a) reaches a reasonable structured state by the end, and
 *  (b) doesn't get stuck in loops or over-medicalise its language.
 */

export interface Persona {
  id: string;
  description: string;
  reply(turnIndex: number, agentText: string): string;
  /** Optional: assertions to run against the final IntakeState. */
  assertions: Array<{
    name: string;
    check: (state: import('../src/lib/clinical-schema').IntakeState) => boolean;
  }>;
  /** Max turns before forcibly ending. */
  maxTurns: number;
}

const includesAny = (s: string, words: string[]) =>
  words.some((w) => s.toLowerCase().includes(w.toLowerCase()));

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 1 — chest pain (red-flag-shaped)
// ─────────────────────────────────────────────────────────────────────────────
export const chestPainPatient: Persona = {
  id: 'chest-pain',
  description:
    '54-year-old male, chest pain x2 days, exertional, mild diaphoresis. Should trigger cardiovascular ROS + at least one moderate/high red flag.',
  maxTurns: 18,
  reply(turn, q) {
    const t = q.toLowerCase();
    if (turn === 0) return 'My chest has been hurting for a couple of days. It scares me a bit.';
    if (includesAny(t, ['name', 'who am i speaking', 'first name'])) return 'Daniel.';
    if (includesAny(t, ['age', 'how old', 'years old'])) return 'I am 54.';
    if (includesAny(t, ['sex', 'male or female', 'assigned at birth'])) return 'Male.';
    if (includesAny(t, ['where', 'location', 'point to', 'side'])) return 'Right in the middle of my chest, sometimes spreads to my left arm.';
    if (includesAny(t, ['what does it feel', 'describe', 'character', 'sharp', 'dull', 'burning', 'tight'])) return 'Tight, almost like a heavy pressure.';
    if (includesAny(t, ['when did', 'onset', 'how long', 'started'])) return 'Two days ago, started while I was walking up the stairs at work.';
    if (includesAny(t, ['constant', 'come and go', 'all the time', 'intermittent'])) return 'Comes and goes — usually when I am moving around. Eases when I sit down.';
    if (includesAny(t, ['worse', 'aggravat', 'trigger'])) return 'Walking up stairs or carrying groceries.';
    if (includesAny(t, ['better', 'reliev', 'help'])) return 'Sitting still helps. I tried an antacid, did not really do anything.';
    if (includesAny(t, ['1 to 10', '0 to 10', 'severity', 'how bad', 'scale'])) return 'When it hits, maybe a 6 out of 10.';
    if (includesAny(t, ['sweat', 'diaphor'])) return 'Yes, I have noticed I get sweaty when it is bad.';
    if (includesAny(t, ['nausea', 'vomit', 'sick to your stomach'])) return 'A little nauseated yesterday, no vomiting.';
    if (includesAny(t, ['short of breath', 'breathing', 'breath'])) return 'A bit short of breath when the pain is there.';
    if (includesAny(t, ['palpit', 'racing', 'fluttering'])) return 'No racing heart that I noticed.';
    if (includesAny(t, ['cough', 'fever', 'chill'])) return 'No cough, no fever.';
    if (includesAny(t, ['food', 'eating', 'meal', 'reflux', 'heartburn'])) return 'Not really food-related. I sometimes get heartburn but this feels different.';
    if (includesAny(t, ['allerg'])) return 'No drug allergies that I know of.';
    if (includesAny(t, ['medication', 'meds', 'taking', 'pills'])) return 'Just a daily aspirin and lisinopril for my blood pressure.';
    if (includesAny(t, ['medical history', 'pmh', 'conditions', 'past'])) return 'High blood pressure, and my dad had a heart attack at 60.';
    if (includesAny(t, ['emergency', 'er', 'urgent care', 'hospital'])) return 'I have not been to the ER yet — that is why I called you.';
    if (includesAny(t, ['anything else', 'else you', 'anything you'])) return 'No, I think that covers it.';
    return 'I am not sure, sorry.';
  },
  assertions: [
    { name: 'CC captured', check: (s) => s.cc !== null && /chest|pain/i.test(s.cc.verbatim) },
    { name: 'OLDCARTS location filled', check: (s) => s.hpi.oldcarts.location !== null },
    { name: 'OLDCARTS character filled', check: (s) => s.hpi.oldcarts.character !== null },
    { name: 'OLDCARTS aggravating filled', check: (s) => s.hpi.oldcarts.aggravating !== null },
    { name: 'CV ROS probed', check: (s) => 'cardiovascular' in s.ros },
    { name: '≥1 red flag raised', check: (s) => s.redFlags.length >= 1 },
    { name: 'Allergies asked', check: (s) => s.allergies.length > 0 },
    { name: 'Meds asked', check: (s) => s.currentMedications.length > 0 },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 2 — migraine (no red flags)
// ─────────────────────────────────────────────────────────────────────────────
export const migrainePatient: Persona = {
  id: 'migraine',
  description:
    '32-year-old female, throbbing unilateral headache with photophobia, history of similar. Should probe neuro ROS, no red flags.',
  maxTurns: 16,
  reply(turn, q) {
    const t = q.toLowerCase();
    if (turn === 0) return 'I have a really bad headache that started yesterday afternoon and it is not going away.';
    if (includesAny(t, ['name', 'first name'])) return 'Priya.';
    if (includesAny(t, ['age', 'how old'])) return '32.';
    if (includesAny(t, ['sex', 'male or female', 'assigned at birth'])) return 'Female.';
    if (includesAny(t, ['where', 'location', 'side', 'point'])) return 'Mostly the right side of my head, behind the eye.';
    if (includesAny(t, ['feel like', 'character', 'describe', 'throb', 'sharp', 'dull'])) return 'Throbbing, like a pulse.';
    if (includesAny(t, ['onset', 'start', 'how long', 'when did'])) return 'Yesterday around 3pm. It came on over an hour or so.';
    if (includesAny(t, ['worse', 'aggravat'])) return 'Bright lights and loud sound make it much worse. Bending over too.';
    if (includesAny(t, ['better', 'reliev', 'help'])) return 'A dark room helps a little. I took ibuprofen — it took the edge off but did not stop it.';
    if (includesAny(t, ['scale', 'severity', '0 to 10', '1 to 10'])) return 'About a 7 out of 10 right now.';
    if (includesAny(t, ['nausea', 'vomit', 'sick'])) return 'Yes, a bit nauseated, no vomiting.';
    if (includesAny(t, ['vision', 'blur', 'aura', 'see'])) return 'I had some shimmering in my vision before it started, like little zigzags.';
    if (includesAny(t, ['weakness', 'numb', 'speech', 'face droop'])) return 'No weakness, no numbness, my speech feels normal.';
    if (includesAny(t, ['neck', 'stiff', 'fever'])) return 'No stiff neck, no fever.';
    if (includesAny(t, ['thunder', 'worst headache', 'sudden'])) return 'It was not a sudden thunderclap, it built up over an hour.';
    if (includesAny(t, ['similar before', 'past', 'happened before', 'history of'])) return 'Yes, I get migraines maybe once every couple of months — usually like this.';
    if (includesAny(t, ['allerg'])) return 'No drug allergies.';
    if (includesAny(t, ['medication', 'meds', 'taking', 'pills'])) return 'Just an oral contraceptive, and ibuprofen as needed.';
    if (includesAny(t, ['medical history', 'conditions', 'pmh', 'past'])) return 'Just migraines. Otherwise healthy.';
    if (includesAny(t, ['anything else', 'else you'])) return 'No, just want it to stop.';
    return 'I am not sure.';
  },
  assertions: [
    { name: 'CC captured', check: (s) => s.cc !== null && /head|migrain/i.test(s.cc.verbatim) },
    { name: 'OLDCARTS character filled', check: (s) => s.hpi.oldcarts.character !== null },
    { name: 'OLDCARTS severity filled', check: (s) => s.hpi.oldcarts.severity !== null },
    { name: 'Neurological ROS probed', check: (s) => 'neurological' in s.ros },
    { name: 'No high red flag raised', check: (s) => !s.redFlags.some((r) => r.severity === 'high') },
    { name: 'Prior episodes captured', check: (s) => s.hpi.priorEpisodes !== null || s.hpi.context !== null },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// PERSONA 3 — RUQ abdominal pain (potential gallbladder/biliary)
// ─────────────────────────────────────────────────────────────────────────────
export const ruqPainPatient: Persona = {
  id: 'ruq-abdominal-pain',
  description:
    '46-year-old female, RUQ pain after fatty meals, several days, intermittent. GI ROS expected; biliary red flags should be screened.',
  maxTurns: 16,
  reply(turn, q) {
    const t = q.toLowerCase();
    if (turn === 0) return 'My stomach has been hurting since Saturday, mostly in the upper right side.';
    if (includesAny(t, ['name'])) return 'Janet.';
    if (includesAny(t, ['age', 'old'])) return '46.';
    if (includesAny(t, ['sex', 'female', 'male'])) return 'Female.';
    if (includesAny(t, ['where', 'location', 'side', 'point', 'show'])) return 'Just under my ribs on the right side, sometimes goes to my back.';
    if (includesAny(t, ['feel like', 'describe', 'character', 'sharp', 'cramp', 'dull'])) return 'Crampy, like a deep ache, sometimes sharp.';
    if (includesAny(t, ['when', 'onset', 'start'])) return 'Started Saturday night after dinner. We had pizza.';
    if (includesAny(t, ['constant', 'come and go', 'intermittent', 'all the time'])) return 'Comes and goes. Worst about half an hour after eating.';
    if (includesAny(t, ['worse', 'aggravat', 'after eating', 'food'])) return 'Especially after greasy or rich food. Pizza and butter make it bad.';
    if (includesAny(t, ['better', 'reliev', 'help'])) return 'Curling up helps. Antacids did not really do much.';
    if (includesAny(t, ['scale', 'severity', '0 to 10', '1 to 10'])) return 'When it peaks maybe a 7. Most of the time about a 4.';
    if (includesAny(t, ['nausea', 'vomit'])) return 'Yes, nauseated. I threw up once on Sunday.';
    if (includesAny(t, ['fever', 'chill'])) return 'No fever or chills that I noticed.';
    if (includesAny(t, ['yellow', 'jaundice', 'eyes'])) return 'My eyes look normal — no yellow.';
    if (includesAny(t, ['stool', 'bowel', 'diarrhea', 'constip', 'urine'])) return 'My stool has been a bit pale the last day or two. Urine looks darker than usual.';
    if (includesAny(t, ['weight', 'appetite'])) return 'I have not been eating much because of the pain. No real weight change.';
    if (includesAny(t, ['similar', 'before', 'past'])) return 'Maybe a milder version a couple of months ago, went away on its own.';
    if (includesAny(t, ['allerg'])) return 'Penicillin gives me a rash.';
    if (includesAny(t, ['medication', 'meds', 'taking'])) return 'Just a multivitamin and occasional ibuprofen.';
    if (includesAny(t, ['medical history', 'past', 'conditions'])) return 'Nothing major, mild high cholesterol.';
    if (includesAny(t, ['pregnan'])) return 'No, not pregnant.';
    if (includesAny(t, ['anything else', 'else you'])) return 'No, I think that is everything.';
    return 'I am not sure.';
  },
  assertions: [
    { name: 'CC captured', check: (s) => s.cc !== null && /stomach|abdomen|pain/i.test(s.cc.verbatim) },
    { name: 'OLDCARTS location filled', check: (s) => s.hpi.oldcarts.location !== null },
    { name: 'OLDCARTS aggravating filled', check: (s) => s.hpi.oldcarts.aggravating !== null },
    { name: 'GI ROS probed', check: (s) => 'gastrointestinal' in s.ros },
    { name: 'Allergies captured (penicillin)', check: (s) => s.allergies.some((a) => /penicillin/i.test(a)) },
  ],
};

export const ALL_PERSONAS: Persona[] = [chestPainPatient, migrainePatient, ruqPainPatient];
