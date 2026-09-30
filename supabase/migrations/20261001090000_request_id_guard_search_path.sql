-- Advisor follow-up (2026-10-01): pin search_path on the request-id guard trigger
-- added by 20260914090000_phase2_integrity. No behavior change.
alter function public.st_validate_job_command_request_id() set search_path=public,pg_temp;
