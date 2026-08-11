import { computeOverallStatus } from './od-status.util';

describe('computeOverallStatus', () => {
  it('returns pending_mentor while the mentor has not yet decided', () => {
    expect(computeOverallStatus('pending', [])).toBe('pending_mentor');
    expect(computeOverallStatus('pending', ['pending', 'approved'])).toBe('pending_mentor');
  });

  it('returns rejected when the mentor rejects, regardless of HoD approval state', () => {
    expect(computeOverallStatus('rejected', [])).toBe('rejected');
    expect(computeOverallStatus('rejected', ['approved'])).toBe('rejected');
    expect(computeOverallStatus('rejected', ['pending'])).toBe('rejected');
  });

  it('returns pending_hod once the mentor approves but a department is still pending', () => {
    expect(computeOverallStatus('approved', ['approved', 'pending'])).toBe('pending_hod');
  });

  it('returns rejected once the mentor approves if any department rejected, even if others are pending', () => {
    expect(computeOverallStatus('approved', ['pending', 'rejected'])).toBe('rejected');
  });

  it('returns approved once the mentor approves and every department has approved', () => {
    expect(computeOverallStatus('approved', ['approved', 'approved'])).toBe('approved');
    expect(computeOverallStatus('approved', [])).toBe('approved');
  });
});
