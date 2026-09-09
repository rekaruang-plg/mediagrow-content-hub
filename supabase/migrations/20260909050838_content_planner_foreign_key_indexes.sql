create index idx_content_plans_created_by on public.content_plans(created_by);
create index idx_content_plan_comments_user on public.content_plan_comments(user_id);
