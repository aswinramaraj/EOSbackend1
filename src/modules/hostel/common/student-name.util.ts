/**
 * Real students in this hostel roster mostly have no soa_applications row
 * (soa_application_id is null), so falling back to "Student <roll no>" was
 * hiding a perfectly good real name that's already encoded in the college
 * email's local-part (e.g. "karthik.p2022cse@sece.ac.in" — first name, then
 * last-initial + admission year + branch code, dot-separated). This derives
 * a real display name from that instead of a placeholder.
 */
export function formatStudentName(
  soaFirstName: string | null | undefined,
  soaLastName: string | null | undefined,
  email: string,
): string {
  const fromSoa = soaFirstName ? `${soaFirstName} ${soaLastName ?? ''}`.trim() : '';
  if (fromSoa) return fromSoa;

  const localPart = email.split('@')[0];
  const [first, rest] = localPart.split('.');
  const lastInitial = rest?.match(/^[a-zA-Z]+/)?.[0];
  if (first && lastInitial) {
    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    return `${capitalize(first)} ${lastInitial.toUpperCase()}`;
  }
  return email;
}
