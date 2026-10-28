/** Public URL of the site, used in generated reports. */
export const SITE_URL = 'https://csp-explained.com';

/** GitHub repository hosting the code and the vendor catalogue. */
export const REPO_URL = 'https://github.com/tcoppin/csp-explained';

export const EXAMPLE_POLICY =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; " +
  "font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.google-analytics.com; " +
  "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; report-uri /csp-report";

export function outdatedIssueUrl(vendorId: string, vendorName: string): string {
  const params = new URLSearchParams({
    title: `Outdated catalogue entry: ${vendorName}`,
    body: `The entry \`catalogue/vendors/${vendorId}.yaml\` looks outdated.\n\nWhat changed (link to the vendor's documentation if possible):\n\n`,
    labels: 'catalogue',
  });
  return `${REPO_URL}/issues/new?${params}`;
}
