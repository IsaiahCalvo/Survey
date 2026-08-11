# Auth mailer template rollback snapshots

Written: 2026-08-11 13:45

Pre-change values of every Supabase Auth mailer template modified on
2026-08-11 when the unbranded auth templates were moved onto the shared
branded email frame (supabase/functions/_shared/emailLayout.ts — see
docs/design/email-style-guide.md).

Source: GET https://api.supabase.com/v1/projects/cvamwtpsuvxvjdnotbeg/config/auth
fetched 2026-08-11, immediately before the PATCH.

To roll one back, PATCH the same endpoint with the field name (file name minus
the .pre-*.html suffix) set to the file's contents. No smtp_* or subject fields
were touched. The four gold-branded templates (confirmation, invite,
magic_link, recovery) were NOT modified — they are the locked visual precedent.

Fields changed:
- mailer_templates_email_change_content
- mailer_templates_reauthentication_content
- mailer_templates_password_changed_notification_content
- mailer_templates_email_changed_notification_content
- mailer_templates_phone_changed_notification_content
- mailer_templates_mfa_factor_enrolled_notification_content
- mailer_templates_mfa_factor_unenrolled_notification_content
- mailer_templates_identity_linked_notification_content
- mailer_templates_identity_unlinked_notification_content
