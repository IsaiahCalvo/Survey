#!/bin/bash
SP="$1"
for i in $(seq 1 40); do
  R=$($SP/q.sh "with victims as (select b.id from public.kal266_backup_deleted_2026_08_19 b join public.document_annotations a on a.id=b.id limit 2000)
   , del as (delete from public.document_annotations d using victims v where d.id=v.id returning 1)
   select count(*) deleted from del")
  echo "batch $i: $R"
  echo "$R" | grep -q '"deleted":0' && { echo ALLDONE; break; }
done
