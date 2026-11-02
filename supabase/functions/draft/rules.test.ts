import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { enforceDraftRules, isMismatch, looksLikeResume, misstatesStage, profileOverlap } from "./rules.ts";

const HS = "Current stage: High school senior.";

Deno.test("adds a Dear Professor greeting and fixes self-descriptions for high schoolers", () => {
  const out = enforceDraftRules({ subject: "EEG question", body: "I am an undergrad who built X.\n\nAayushya Patel" }, "Daniel S. Margulies", HS);
  assertEquals(out.body, "Dear Professor Margulies,\n\nI am a high school student who built X.\n\nAayushya Patel");
});

Deno.test("never mangles phrases it doesn't understand", () => {
  // Regression: a blind replace once produced "high school-free question".
  const d = { subject: "Undergraduate-free question on EEG", body: "Dear Professor Lee,\n\nText." };
  assertEquals(enforceDraftRules(d, "Lee", HS).subject, "Undergraduate-free question on EEG");
  assertEquals(misstatesStage(d, HS), true); // caller asks the model to rewrite instead
});

Deno.test("leaves undergrads and existing greetings alone", () => {
  const d = { subject: "Undergrad research question", body: "Dear Professor Lee,\n\nI am an undergrad." };
  assertEquals(enforceDraftRules(d, "Wee Sun Lee", "Current stage: Undergraduate at UCLA."), d);
  assertEquals(misstatesStage(d, "Current stage: Undergraduate at UCLA."), false);
});

Deno.test("resume gate rejects keyboard mash, accepts a short real bio", () => {
  assertEquals(looksLikeResume("asdfasfasdfasf"), false);
  assertEquals(looksLikeResume("asdf ".repeat(40)), false);
  assertEquals(looksLikeResume("I like robots."), false);
  assertEquals(looksLikeResume("Junior at Cupertino High. Built an EEG forecasting model in Python and a 6-DOF robotic arm for plasma wound therapy. Interested in soft robotics."), true);
});

// ---- Mismatch guard ----
// Real-ish student profile: soft robotics + EEG high schooler.
const STUDENT = `Current stage: High school senior at Cupertino High.
Skills: Python, CAD, 3D printing, EEG signal processing, Arduino.
Experience: built a soft robotic gripper with silicone actuators and pneumatic control;
trained an EEG classifier for a brain-computer interface to control a robotic arm.
Research interests: soft robotics, wearable sensors, brain-computer interfaces.`;

// Ryan L. Truby (soft robotics, Northwestern) - should PASS (overlaps the student's work).
const TRUBY = [
  { title: "Soft somatosensitive actuators via embedded 3D printing", abstract: "We present soft robotic actuators with embedded sensors fabricated by 3D printing of conductive and silicone inks for proprioception in soft robots." },
  { title: "Fast, autonomous soft matter actuators for soft robots", abstract: "Pneumatic and liquid-crystal elastomer actuators enable soft robotic grippers and locomotion." },
  { title: "Learning the signatures of soft robotic sensors", abstract: "Machine learning decodes embedded sensor signals for soft robot state estimation." },
];

// Robin Patel (clinical microbiology, Mayo Clinic) - should FLAG (no overlap with the student).
const PATEL = [
  { title: "Metaproteomic analysis of human sonicate fluid highlights neutrophil extracellular trap formation associated with periprosthetic joint infection", abstract: "Sonicate fluid from infected prosthetic joints was analyzed; neutrophil extracellular traps correlate with periprosthetic joint infection caused by Staphylococcus." },
  { title: "Rapid diagnosis of bacteremia using the T2 magnetic resonance assay", abstract: "Clinical microbiology diagnostics for bloodstream infections and antimicrobial susceptibility testing of pathogens." },
  { title: "Antibiotic resistance in bacterial prosthetic joint infection", abstract: "We characterize antimicrobial resistance among bacterial isolates from prosthetic joint infections in patients." },
];

Deno.test("mismatch guard: soft-robotics student passes a soft-robotics professor", () => {
  const r = isMismatch(STUDENT, TRUBY);
  assertEquals(r.mismatch, false);
});

Deno.test("mismatch guard: soft-robotics student is flagged against a clinical microbiologist", () => {
  const r = isMismatch(STUDENT, PATEL);
  assertEquals(r.mismatch, true);
});

Deno.test("mismatch guard: empty paper text never blocks", () => {
  assertEquals(isMismatch(STUDENT, []).mismatch, false);
  assertEquals(isMismatch(STUDENT, [{ title: "", abstract: "" }]).mismatch, false);
});

Deno.test("profileOverlap: shared terms are real content words", () => {
  const { shared } = profileOverlap(STUDENT, TRUBY.map((p) => p.title + " " + p.abstract));
  // "soft", "robot(ic)", "actuator", "sensor" should all be caught after stemming.
  assertEquals(shared.includes("soft"), true);
  assertEquals(shared.length >= 3, true);
});
