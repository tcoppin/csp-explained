import { Rich } from '../ui/Rich';

/**
 * Shown beside the tools when the policy enforces Trusted Types: no tool in the catalogue documents whether it
 * works with them, so the honest advice is to test first.
 */
export function TrustedTypesNote() {
  return (
    <p class="trusted-types-note" role="note">
      <Rich msg="trustedTypes.toolsNote" />
    </p>
  );
}
