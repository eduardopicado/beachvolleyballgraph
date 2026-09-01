/**
 * CSS linting, for the class of bug the other checks cannot see.
 *
 * The prompt for this was a real one. Resolving a rebase conflict in
 * `PlayerCard.css` dropped a closing brace, so `.vitals .birth-place` swallowed
 * every rule after it — including the whole filter chip row. `tsc` does not
 * read CSS, `vite build` parsed it without complaint, and the unit suite has no
 * opinion, so the only thing that noticed was an end-to-end test reporting that
 * a phone page scrolled sideways by 60px. That is a long way from the cause.
 *
 * `stylelint-config-recommended` is the errors-only preset: no formatting
 * opinions at all, just the rules that catch things which are wrong rather than
 * merely unlike somebody's house style. Measured against this repo's eight
 * stylesheets, the full standard preset reports 125 problems — colour notation,
 * blank lines before comments — and adopting it would mean a reformatting
 * commit before the check could gate anything. The recommended preset reports
 * 14, and the two rules below account for all of them.
 */
export default {
  extends: 'stylelint-config-recommended',
  rules: {
    /**
     * Off, with 13 existing violations left in place.
     *
     * A later rule with lower specificity than an earlier one *can* be a bug —
     * the earlier rule silently wins — but in this stylesheet the cases are
     * deliberate: a base rule followed by a narrower state, written in the
     * order a reader follows rather than the order the cascade resolves.
     * Turning it on means changing thirteen selectors to satisfy a rule that
     * has not caught anything here, which is a different piece of work with a
     * different risk. Worth revisiting on its own, not smuggled in with a
     * check whose job is catching broken syntax.
     */
    'no-descending-specificity': null,
  },
};
