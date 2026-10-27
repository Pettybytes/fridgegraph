-- 0002 — Seed: the same fictional village as src/fixtures.ts, id for id.
-- Idempotent: safe to re-run.

insert into villages (id, name) values
  ('v_nora', 'Nora''s village'),
  ('v_jax',  'Jax''s village')
on conflict (id) do nothing;

insert into people (id, display_name, birth_date) values
  ('p_nora','Nora Ellison','2018-03-14'),
  ('p_mom','Kendra Ellison','1988-05-02'),
  ('p_dad','Andre Ellison','1986-09-20'),
  ('p_leo','Leo Ellison','2010-10-29'),
  ('p_max','Max Ellison','2013-06-02'),
  ('p_gma','Loretta Brooks','1957-11-08'),
  ('p_bryan','Bryan Brooks','1984-01-30'),
  ('p_walter','Walter Ellison','1955-04-22'),
  ('p_gloria','Gloria Ellison','1958-12-09'),
  ('p_tasha','Tasha Ellison','1990-02-17'),
  ('p_monique','Monique Davis','1987-07-30'),
  ('p_chris','Chris Harlan','1985-03-11'),
  ('p_priya','Priya Nair','2003-09-05'),
  ('p_price','Angela Price','1982-01-19'),
  ('p_okafor','Daniel Okafor','1991-06-27'),
  ('p_jennings','Carol Jennings','1975-10-03'),
  ('p_holt','Gary Holt','1968-02-14'),
  ('p_marcus','Marcus Reyes','1979-08-05'),
  ('p_jax','Jax Coleman','2018-07-21'),
  ('p_dana','Dana Coleman','1987-04-11'),
  ('p_ray','Ray Coleman','1985-12-03'),
  ('p_evelyn','Evelyn Carter','1960-05-16')
on conflict (id) do nothing;

insert into children (person_id) values ('p_nora'), ('p_jax') on conflict do nothing;

insert into households (id, village_id) values
  ('h_a','v_nora'), ('h_b','v_nora'), ('h_c','v_jax'), ('h_d','v_jax')
on conflict (id) do nothing;

insert into household_members (person_id, household_id, role) values
  ('p_mom','h_a','parent'), ('p_leo','h_a','child'), ('p_max','h_a','child'), ('p_nora','h_a','child'),
  ('p_dad','h_b','parent'), ('p_nora','h_b','child'),
  ('p_dana','h_c','parent'), ('p_jax','h_c','child'),
  ('p_ray','h_d','parent'), ('p_jax','h_d','child')
on conflict do nothing;

insert into relationships (id, from_id, to_id, type, status, created_at, history) values
  ('r_kendra_parent','p_mom','p_nora','parent','ACTIVE','2018-03-14','[{"at":"2018-03-14","event":"ACTIVE (parent)"}]'),
  ('r_andre_parent','p_dad','p_nora','parent','ACTIVE','2018-03-14','[{"at":"2018-03-14","event":"ACTIVE (parent)"}]'),
  ('r_leo_brother','p_leo','p_nora','brother','ACTIVE','2018-03-14','[{"at":"2018-03-14","event":"ACTIVE (brother)"}]'),
  ('r_max_brother','p_max','p_nora','brother','ACTIVE','2018-03-14','[{"at":"2018-03-14","event":"ACTIVE (brother)"}]'),
  ('r_loretta_grandmother','p_gma','p_nora','grandmother','ACTIVE','2026-10-01','[{"at":"2026-10-01","event":"ACTIVE (grandmother)"}]'),
  ('r_walter_grandfather','p_walter','p_nora','grandfather','ACTIVE','2026-10-01','[{"at":"2026-10-01","event":"ACTIVE (grandfather)"}]'),
  ('r_gloria_grandmother','p_gloria','p_nora','grandmother','ACTIVE','2026-10-01','[{"at":"2026-10-01","event":"ACTIVE (grandmother)"}]'),
  ('r_bryan_uncle','p_bryan','p_nora','uncle','ACTIVE','2026-10-01','[{"at":"2026-10-01","event":"ACTIVE (uncle)"}]'),
  ('r_tasha_aunt','p_tasha','p_nora','aunt','ACTIVE','2026-10-01','[{"at":"2026-10-01","event":"ACTIVE (aunt)"}]'),
  ('r_tasha_godmother','p_tasha','p_nora','godmother','ACTIVE','2026-10-01','[{"at":"2026-10-01","event":"ACTIVE (godmother)"}]'),
  ('r_monique_parent_friend','p_monique','p_nora','parent_friend','ACTIVE','2026-10-01','[{"at":"2026-10-01","event":"ACTIVE (parent_friend)"}]'),
  ('r_chris_parent_friend','p_chris','p_nora','parent_friend','ACTIVE','2026-10-01','[{"at":"2026-10-01","event":"ACTIVE (parent_friend)"}]'),
  ('r_priya_sitter','p_priya','p_nora','sitter','ACTIVE','2026-10-01','[{"at":"2026-10-01","event":"ACTIVE (sitter)"}]'),
  ('r_angela_teacher','p_price','p_nora','teacher','ACTIVE','2026-10-01','[{"at":"2026-10-01","event":"ACTIVE (teacher)"}]'),
  ('r_daniel_substitute','p_okafor','p_nora','substitute_teacher','ACTIVE','2026-10-01','[{"at":"2026-10-01","event":"ACTIVE (substitute_teacher)"}]'),
  ('r_carol_nurse','p_jennings','p_nora','school_nurse','ACTIVE','2026-10-01','[{"at":"2026-10-01","event":"ACTIVE (school_nurse)"}]'),
  ('r_gary_bus_driver','p_holt','p_nora','bus_driver','ACTIVE','2026-10-01','[{"at":"2026-10-01","event":"ACTIVE (bus_driver)"}]'),
  ('r_marcus_coach','p_marcus','p_nora','coach','ACTIVE','2026-10-01','[{"at":"2026-10-01","event":"ACTIVE (coach)"}]'),
  ('r_dana_friend_parent','p_dana','p_nora','friend_parent','DISCOVERED','2026-10-24','[{"at":"2026-10-24","event":"DISCOVERED (friend_parent)"}]'),
  ('r_dana_parent','p_dana','p_jax','parent','ACTIVE','2018-07-21','[{"at":"2018-07-21","event":"ACTIVE (parent)"}]'),
  ('r_ray_parent','p_ray','p_jax','parent','ACTIVE','2018-07-21','[{"at":"2018-07-21","event":"ACTIVE (parent)"}]'),
  ('r_evelyn_grandmother','p_evelyn','p_jax','grandmother','ACTIVE','2026-10-01','[{"at":"2026-10-01","event":"ACTIVE (grandmother)"}]'),
  ('r_jax_angela_teacher','p_price','p_jax','teacher','ACTIVE','2026-10-01','[{"at":"2026-10-01","event":"ACTIVE (teacher)"}]'),
  ('r_jax_daniel_substitute','p_okafor','p_jax','substitute_teacher','ACTIVE','2026-10-01','[{"at":"2026-10-01","event":"ACTIVE (substitute_teacher)"}]'),
  ('r_jax_marcus_coach','p_marcus','p_jax','coach','ACTIVE','2026-10-01','[{"at":"2026-10-01","event":"ACTIVE (coach)"}]')
on conflict (id) do nothing;

insert into contact_methods (person_id, channel, value, preferred, verified) values
  ('p_mom','SMS','+1-313-555-0101',true,true), ('p_mom','EMAIL','kendra.ellison@example.com',false,true),
  ('p_dad','SMS','+1-313-555-0102',true,true), ('p_dad','EMAIL','andre.ellison@example.com',false,true),
  ('p_gma','CALL','+1-313-555-0103',true,true),
  ('p_bryan','SMS','+1-313-555-0104',true,true),
  ('p_walter','CALL','+1-313-555-0105',true,true),
  ('p_gloria','SMS','+1-313-555-0106',true,true),
  ('p_tasha','SMS','+1-313-555-0107',true,true),
  ('p_monique','SMS','+1-313-555-0108',true,true),
  ('p_chris','SMS','+1-313-555-0109',true,true),
  ('p_priya','SMS','+1-313-555-0110',true,true),
  ('p_dana','SMS','+1-313-555-0111',true,false),
  ('p_ray','SMS','+1-313-555-0112',true,true),
  ('p_evelyn','CALL','+1-313-555-0113',true,true),
  ('p_leo','SMS','+1-313-555-0114',true,false),
  ('p_max','SMS','+1-313-555-0115',true,false),
  ('p_price','EMAIL','angela.price@example.com',true,true),
  ('p_okafor','EMAIL','daniel.okafor@example.com',true,true),
  ('p_jennings','EMAIL','carol.jennings@example.com',true,true),
  ('p_holt','SMS','+1-313-555-0119',true,true),
  ('p_marcus','SMS','+1-313-555-0120',true,true)
on conflict do nothing;

insert into capabilities (person_id, name, conditions) values
  ('p_gma','transport.child',null), ('p_bryan','transport.child',null), ('p_tasha','transport.child',null),
  ('p_monique','transport.child',null), ('p_chris','transport.child',null), ('p_walter','transport.child',null),
  ('p_dana','transport.child',null), ('p_ray','transport.child',null), ('p_evelyn','transport.child',null),
  ('p_priya','supervise.child',null), ('p_leo','supervise.sibling',null), ('p_dana','host.playdate',null),
  ('p_marcus','activities.update',null), ('p_price','school.report',null), ('p_jennings','school.report',null),
  ('p_holt','transport.roster',null)
on conflict do nothing;

insert into groups (id, name, kind) values
  ('g_room12','Room 12, Lincoln Elementary','class'),
  ('g_school','Lincoln Elementary','school'),
  ('g_route14','Bus Route 14','bus'),
  ('g_tigers','Tigers U9 soccer','team')
on conflict (id) do nothing;

insert into memberships (person_id, group_id, role) values
  ('p_price','g_room12','teacher'), ('p_okafor','g_room12','substitute'),
  ('p_nora','g_room12','student'), ('p_jax','g_room12','student'),
  ('p_jennings','g_school','nurse'), ('p_holt','g_route14','driver'),
  ('p_nora','g_route14','rider'), ('p_marcus','g_tigers','coach'),
  ('p_nora','g_tigers','player'), ('p_jax','g_tigers','player')
on conflict do nothing;

insert into goals (id, child_id, title, owner_id, proposed_by_id, horizon, status) values
  ('goal_reading','p_nora','Reading level 3 by June','p_mom',null,'June 2027','APPROVED'),
  ('goal_passing','p_nora','Left-foot passing this season',null,'p_marcus','2026 season','PROPOSED')
on conflict (id) do nothing;

insert into care_plans (child_id, text) values
  ('p_nora','Peanut allergy. Epi-pen in right backpack pocket.'),
  ('p_jax','Mild asthma. Inhaler in the front pocket of the school bag.')
on conflict (child_id) do nothing;

insert into grants (id, actor_id, child_id, scopes, valid_from, valid_until, granted_by) values
  ('g_loretta','p_gma','p_nora',array['pickup.request','schedule.read','goals.read'],null,null,'p_mom'),
  ('g_bryan','p_bryan','p_nora',array['pickup.request','schedule.read'],null,null,'p_mom'),
  ('g_tasha','p_tasha','p_nora',array['pickup.request','schedule.read','goals.read'],null,null,'p_mom'),
  ('g_monique','p_monique','p_nora',array['pickup.request','schedule.read'],null,null,'p_mom'),
  ('g_walter','p_walter','p_nora',array['schedule.read','goals.read'],null,null,'p_dad'),
  ('g_gloria','p_gloria','p_nora',array['schedule.read','goals.read'],null,null,'p_dad'),
  ('g_priya','p_priya','p_nora',array['supervise.request','schedule.read','careplan.read'],null,null,'p_mom'),
  ('g_leo','p_leo','p_nora',array['supervise.request','schedule.read'],null,null,'p_mom'),
  ('g_angela','p_price','p_nora',array['school.read','careplan.read','pickup.verify'],null,null,'p_mom'),
  ('g_daniel','p_okafor','p_nora',array['careplan.read'],'2026-10-26','2026-10-26','p_mom'),
  ('g_carol','p_jennings','p_nora',array['careplan.read','school.read'],null,null,'p_mom'),
  ('g_chris_expired','p_chris','p_nora',array['careplan.read'],'2026-09-01','2026-09-30','p_mom'),
  ('g_gary','p_holt','p_nora',array['transport.read'],null,null,'p_mom'),
  ('g_evelyn','p_evelyn','p_jax',array['pickup.request','schedule.read'],null,null,'p_dana'),
  ('g_jax_angela','p_price','p_jax',array['school.read','pickup.verify'],null,null,'p_dana')
on conflict (id) do nothing;

insert into household_policies (household_id, rule, value) values
  ('h_a','sibling_supervision_min_age','16'),
  ('h_a','caregiver_approval','ANY_PARENT')
on conflict do nothing;

insert into parenting_schedules (child_id, parent_id, weekdays) values
  ('p_nora','p_mom',array['MON','TUE','WED']),
  ('p_nora','p_dad',array['THU','FRI','SAT','SUN']),
  ('p_jax','p_dana',array['MON','TUE','WED','THU']),
  ('p_jax','p_ray',array['FRI','SAT','SUN'])
on conflict do nothing;

insert into events (id, child_id, title, start_at, end_at, location) values
  ('e_school_1026','p_nora','School','2026-10-26 08:15:00','2026-10-26 15:00:00','Room 12, Lincoln Elementary')
on conflict (id) do nothing;

insert into bus_rosters (date, child_id, route, riding) values
  ('2026-10-26','p_nora','Route 14',true)
on conflict do nothing;

insert into vehicles (id, owner_id, year, make, model, color, plate) values
  ('v_101','p_mom',2021,'Honda','CR-V','gray','DEMO-101'),
  ('v_102','p_dad',2019,'Ford','F-150','black','DEMO-102'),
  ('v_103','p_gma',2016,'Buick','Enclave','white','DEMO-103'),
  ('v_104','p_bryan',2020,'Dodge','Charger','blue','DEMO-104'),
  ('v_105','p_tasha',2022,'Toyota','RAV4','red','DEMO-105'),
  ('v_106','p_monique',2023,'Kia','Telluride','silver','DEMO-106'),
  ('v_107','p_chris',2015,'Chevrolet','Malibu','gray','DEMO-107'),
  ('v_108','p_walter',2012,'Cadillac','DTS','black','DEMO-108'),
  ('v_109','p_priya',2014,'Toyota','Corolla','white','DEMO-109'),
  ('v_110','p_dana',2018,'Chrysler','Pacifica','silver','DEMO-110'),
  ('v_111','p_ray',2017,'Jeep','Grand Cherokee','green','DEMO-111'),
  ('v_112','p_evelyn',2019,'Buick','Encore','blue','DEMO-112')
on conflict (id) do nothing;

insert into practices (id, group_id, start_at, location) values
  ('pr_tigers_1026','g_tigers','2026-10-26 17:30:00','Field 2')
on conflict (id) do nothing;
