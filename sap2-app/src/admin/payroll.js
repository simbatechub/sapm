"use strict";
// How an ADMINISTRATIVE salary row in the existing payroll is derived from the performance review.
// Instructor rows never go through here (appearances x rate is untouched).
function adminPayrollRow({ enforce, salary, review }) {
  const approved = review && review.approved_pay !== null && review.approved_pay !== undefined ? review.approved_pay : null;
  const finalized = !!review && review.status !== "DRAFT";
  const perf_status = !review ? "NOT_CALCULATED" : !finalized ? "DRAFT" : approved !== null ? "APPROVED" : "FINALIZED";
  // `base` is the best current estimate of the salary part: approved pay > recommended pay (once finalized) > full salary.
  const base = enforce ? (approved !== null ? approved : finalized ? review.recommended_pay : salary) : salary;
  return {
    base,
    awaiting: !!enforce && approved === null, // management must approve before this row can be paid
    extra: {
      base_salary: salary, performance_score: review ? Number(review.final_score) : null, performance_band: review ? review.band : null,
      recommended_pay: finalized ? review.recommended_pay : null, approved_pay: approved, perf_status, enforced: !!enforce,
    },
  };
}
module.exports = { adminPayrollRow };
