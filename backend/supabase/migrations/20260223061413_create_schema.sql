create extension if not exists "pgcrypto";

-- USER PROFILES
create table user_profiles (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    goal text,
    current_skills jsonb default '[]'::jsonb,
    required_skills jsonb default '[]'::jsonb,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- COURSE HISTORY
create table course_history (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references user_profiles(id) on delete cascade,
    course_id text not null,
    decision text check (decision in ('keep','adjust','reject')),
    feedback text,
    created_at timestamptz default now()
);

ALTER TABLE conversation_history
ADD COLUMN IF NOT EXISTS profile_id uuid
REFERENCES user_profiles(id)
ON DELETE CASCADE;

create index idx_course_history_user_id on course_history(user_id);
create index idx_conversation_profile_id on conversation_history(profile_id);