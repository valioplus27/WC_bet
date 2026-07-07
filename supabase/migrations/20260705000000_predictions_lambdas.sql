-- Add λ (expected-goals) columns to predictions so the frontend can
-- compute the full exact-score probability matrix and over/under curve
-- without re-running the Poisson model client-side.
alter table public.predictions
  add column if not exists lambda_home float,
  add column if not exists lambda_away float;
