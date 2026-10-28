/**
 * url-normalize.mjs — Normalizes a job description URL to its direct application form URL.
 * Pure isomorphic helper: safe for both client and server components.
 *
 * Examples:
 * - Ashby: https://jobs.ashbyhq.com/qlub/975d7158... -> https://jobs.ashbyhq.com/qlub/975d7158.../application
 * - Lever: https://jobs.lever.co/org/job-id -> https://jobs.lever.co/org/job-id/apply
 * - Workable: https://apply.workable.com/org/j/job-id -> https://apply.workable.com/org/j/job-id/apply/
 * - SmartRecruiters: https://jobs.smartrecruiters.com/org/job-id -> https://jobs.smartrecruiters.com/org/job-id/apply
 * - Greenhouse: boards.greenhouse.io/org/jobs/job-id -> boards.greenhouse.io/org/jobs/job-id#app
 */
export function normalizeToApplicationUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
  try {
    const parsed = new URL(rawUrl.trim());

    // Ashby: https://jobs.ashbyhq.com/:company/:jobId -> /application
    if (parsed.hostname.endsWith("ashbyhq.com")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length === 2 && parts[1] !== "application") {
        parsed.pathname = `/${parts[0]}/${parts[1]}/application`;
        return parsed.toString();
      }
    }

    // Lever: https://jobs.lever.co/:company/:jobId -> /apply
    if (parsed.hostname.endsWith("lever.co")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length === 2 && parts[1] !== "apply") {
        parsed.pathname = `/${parts[0]}/${parts[1]}/apply`;
        return parsed.toString();
      }
    }

    // Workable: https://apply.workable.com/:company/j/:jobId -> /apply/
    if (parsed.hostname.endsWith("workable.com")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length === 3 && parts[1] === "j" && parts[2] !== "apply") {
        parsed.pathname = `/${parts[0]}/j/${parts[2]}/apply`;
        return parsed.toString();
      }
    }

    // SmartRecruiters: https://jobs.smartrecruiters.com/:company/:jobId -> /apply
    if (parsed.hostname.endsWith("smartrecruiters.com")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length === 2 && parts[1] !== "apply") {
        parsed.pathname = `/${parts[0]}/${parts[1]}/apply`;
        return parsed.toString();
      }
    }

    // Greenhouse: boards.greenhouse.io/:company/jobs/:jobId -> #app
    if (parsed.hostname.endsWith("greenhouse.io")) {
      if (parsed.pathname.includes("/jobs/") && !parsed.hash) {
        parsed.hash = "app";
        return parsed.toString();
      }
    }

    return parsed.toString();
  } catch {
    return rawUrl;
  }
}
