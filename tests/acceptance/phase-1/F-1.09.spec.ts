import { expectNoSeriousA11yViolations } from '../fixtures/axe';
import type { Emulators } from '../fixtures/emulators';
import { accounts, invitedOfA, ORG_A, ORG_B } from '../fixtures/seed';
import { expect, test } from '../fixtures/test';
import { ConsentNotice, DPDP, OrgChooser, ProfileForm } from '../pages/profile-page';
import { studentHome } from '../pages/role-home';
import { StudentShell } from '../pages/shell';

// F-1.09 Student sign-in, org choice and consent (AUTH-04, SEC-08; DATA-01 is proved by integration tests and
// checked here in what is stored). Contract: docs/testids/phase-1.md, "Organization chooser", "Consent notice".

/** The student's claims hold this org, and the student record they name is linked to the account (DATA-01). */
async function expectStudentOf(emulators: Emulators, email: string, orgId: string): Promise<string> {
  const user = await emulators.authAccount(email);
  expect(user.customClaims).toMatchObject({ role: 'student', orgId });
  const studentId = String(user.customClaims.studentId);
  const record = await emulators.doc(`organizations/${orgId}/students/${studentId}`);
  expect(record?.data, `student record ${studentId} in ${orgId}`).toMatchObject({ email, orgId, uid: user.localId });
  return studentId;
}

test.describe('F-1.09 student sign-in, org choice and consent', () => {
  test('AUTH-04 an email whitelisted in two organizations chooses one at sign-in and the claims hold that org', async ({
    page,
    startSignIn,
    emulators,
  }) => {
    await startSignIn(accounts.multi);
    const chooser = new OrgChooser(page);

    await chooser.expectShown();
    await expect(chooser.choices).toHaveCount(2);
    await expect(chooser.choice(ORG_A.name)).toBeVisible();
    await expect(chooser.choice(ORG_B.name)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await chooser.choice(ORG_A.name).click();

    await new ConsentNotice(page).expectShown();
    await expectStudentOf(emulators, accounts.multi.email, ORG_A.id);
  });

  test('AUTH-04 switching organizations repeats bootstrap and moves the claims to the other org', async ({
    page,
    startSignIn,
    emulators,
  }) => {
    await startSignIn(accounts.multi);
    const chooser = new OrgChooser(page);
    await chooser.expectShown();
    await chooser.choice(ORG_A.name).click();
    const consent = new ConsentNotice(page);
    await consent.expectShown();
    const inA = await expectStudentOf(emulators, accounts.multi.email, ORG_A.id);
    const bootstraps: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/v1/session/bootstrap') bootstraps.push(r.url());
    });

    await new StudentShell(page).choose('Switch organization');
    await chooser.expectShown();
    await chooser.choice(ORG_B.name).click();

    await consent.expectShown();
    const inB = await expectStudentOf(emulators, accounts.multi.email, ORG_B.id);
    expect(inB, 'a separate student record in org B').not.toBe(inA);
    expect(bootstraps.length, 'bootstrap ran again for the switch').toBeGreaterThan(0);
    const recordA = await emulators.doc(`organizations/${ORG_A.id}/students/${inA}`);
    expect(recordA, 'the org A record stays').not.toBeNull();
  });

  test('SEC-08 first sign-in shows the DPDP consent notice explaining what is collected and why', async ({
    page,
    startSignIn,
    emulators,
  }) => {
    const invited = invitedOfA(1);
    await startSignIn(invited);
    const consent = new ConsentNotice(page);

    await consent.expectShown();
    await expect(consent.main).toContainText(DPDP);
    for (const what of [
      /\bname\b/i,
      /\bemail\b/i,
      /\bPRN\b/,
      /\bdepartment\b/i,
      /graduation year/i,
      /answers/i,
      /proctoring/i,
    ])
      await expect(consent.main).toContainText(what);
    const studentId = await expectStudentOf(emulators, invited.email, ORG_A.id);
    const path = `organizations/${ORG_A.id}/students/${studentId}`;
    expect((await emulators.doc(path))!.data.consentAt, 'no consent before agreeing').toBeUndefined();
    await expectNoSeriousA11yViolations(page);

    await consent.agree.click();

    await expect(consent.heading).toBeHidden();
    expect(typeof (await emulators.doc(path))!.data.consentAt, 'consentAt stored').toBe('number');
    // invited01's profile is incomplete, so profile completion comes next (STU-01); never the notice again.
    await new ProfileForm(page).expectCompletionShown();
    await page.goto('/student/');
    await new ProfileForm(page).expectCompletionShown();
    await expect(consent.heading, 'the notice is not shown again').toHaveCount(0);
  });

  test('SEC-08 STU-01 a student who has not consented is sent back to the notice from every student page', async ({
    page,
    startSignIn,
  }) => {
    await startSignIn(invitedOfA(2));
    const consent = new ConsentNotice(page);
    await consent.expectShown();

    for (const path of ['/student/', '/profile/', '/student/']) {
      await page.goto(path);
      await consent.expectShown();
      await expect(studentHome(page).heading).toHaveCount(0);
    }
  });

  test('SEC-08 AUTH-04 a registered student in one organization goes straight home, with no chooser and no switch option', async ({
    page,
    signInAs,
  }) => {
    const home = await signInAs(accounts.studentA);
    const student = new StudentShell(page);

    await expect(home.heading).toBeVisible();
    await expect(new ConsentNotice(page).heading).toHaveCount(0);
    await expect(new OrgChooser(page).heading).toHaveCount(0);
    await student.accountMenu.click();
    await expect(student.menuItem('Profile')).toBeVisible();
    await expect(student.menuItem('Sign out')).toBeVisible();
    await expect(student.menuItem('Switch organization')).toHaveCount(0);
  });
});
