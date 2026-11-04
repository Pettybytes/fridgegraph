/**
 * Showcase profiles — FICTIONAL, presentation-only seed text for the Living Village
 * profile card, keyed by person ID exactly like portraits.ts. The ID decides; an
 * unknown ID renders no profile. This module ships only in the lazy profile-card
 * chunk and never grants identity, authority or permission.
 *
 * Ages are deliberately approximate for adults. Messages address the center child
 * of the village being viewed, keyed by that child's person ID, so a person who
 * belongs to two villages speaks to each child in their own voice.
 */
export type ShowcaseProfile = {
 /** Approximate for adults, per the showcase brief. */
 age: number
 job: string
 hobbies: string[]
 goals: string[]
 /** Center-child person ID -> a short warm note to that child. */
 messages: Record<string, string>
}

export const SHOWCASE_PROFILES: Record<string, ShowcaseProfile> = {
 p_mom: {
  age: 38, job: 'Pediatric nurse at a Detroit hospital',
  hobbies: ['Sunday pancakes', 'garden boxes', 'true crime podcasts'],
  goals: ['Keep family dinner on the calendar', 'Run the Detroit half marathon'],
  messages: {
   p_nora: 'You read a whole chapter book by yourself this week. I knew you could. Love you to the moon.',
   p_leo: 'Varsity or not, I am your loudest fan. Pasta night before every tryout.',
   p_max: 'Your dragon drawings belong in a gallery. Museum trip soon, just us.',
  },
 },
 p_nora: {
  age: 8, job: 'Second grader, Room 12 at Lincoln Elementary',
  hobbies: ['Chapter books', 'watercolors', 'recess races'],
  goals: ['Read every Ramona book this year'],
  messages: {
   p_leo: 'You promised hoops with your friends. I did not forget.',
   p_max: 'Draw me in the comic with a cape. I earned it.',
  },
 },
 p_dad: {
  age: 40, job: 'Electrician with his own small crew',
  hobbies: ['Fixing up the old pickup', 'Lions games', 'grilling'],
  goals: ['Build the backyard treehouse before summer'],
  messages: {p_nora: 'The treehouse is happening this summer, I promise. Bring your hammer, helper.'},
 },
 p_leo: {
  age: 16, job: 'Sophomore at Cass Tech',
  hobbies: ['Basketball', 'video editing', 'sneaker trades'],
  goals: ['Make varsity this season'],
  messages: {
   p_nora: 'You can shoot hoops with me and my friends any time, squirt. Bring your good luck headband.',
   p_max: 'Your BMX is getting quick, little man. Race you around the block Sunday.',
  },
 },
 p_max: {
  age: 13, job: 'Seventh grader',
  hobbies: ['Minecraft builds', 'BMX', 'drawing dragons'],
  goals: ['Finish the comic book he started'],
  messages: {
   p_nora: 'I drew you as a superhero in my comic. You get a cape and everything.',
   p_leo: 'Teach me that layup and I will put you on the cover of my comic.',
  },
 },
 p_gma: {
  age: 68, job: 'Retired school librarian',
  hobbies: ['Quilting', 'church choir', 'crossword puzzles'],
  goals: ['Teach Nora the peach cobbler recipe'],
  messages: {p_nora: 'Saturday is cobbler day, sugar. Wear the apron I made you.'},
 },
 p_walter: {
  age: 71, job: 'Retired autoworker, Rouge plant',
  hobbies: ['Fishing at Belle Isle', 'chess', 'old Motown records'],
  goals: ['Get Nora out on the water this spring'],
  messages: {p_nora: 'The fish are waiting on us, kiddo. First catch picks the ice cream.'},
 },
 p_gloria: {
  age: 67, job: 'Retired postal carrier',
  hobbies: ['Line dancing', 'bird watching', 'jigsaw puzzles'],
  goals: ['Walk a mile every morning'],
  messages: {p_nora: 'A cardinal landed on my feeder today and I thought of you, my little bird watcher.'},
 },
 p_bryan: {
  age: 42, job: 'City bus mechanic',
  hobbies: ['Drumming', 'fantasy football', 'smoking ribs'],
  goals: ['Take the kids camping up north'],
  messages: {p_nora: 'Next cookout you are on cornbread duty with me. Chef hat and all.'},
 },
 p_tasha: {
  age: 36, job: 'Hair stylist at a Midtown salon',
  hobbies: ['Roller skating', 'thrifting', 'karaoke'],
  goals: ['Open her own salon chair', 'Never miss a recital'],
  messages: {p_nora: 'Auntie braid day soon! I found beads in every color you love.'},
 },
 p_monique: {
  age: 39, job: 'Dental hygienist',
  hobbies: ['Book club', 'sourdough baking', 'yoga'],
  goals: ['Host the block party again this year'],
  messages: {p_nora: 'We are baking cookies Friday and there is a spot at the counter with your name on it.'},
 },
 p_chris: {
  age: 41, job: 'High school math teacher',
  hobbies: ['Cycling', 'board games', 'woodworking'],
  goals: ['Finish the canoe in his garage'],
  messages: {p_nora: 'Game night needs you back. You are still the reigning Uno champion.'},
 },
 p_priya: {
  age: 23, job: 'Nursing student, evening sitter',
  hobbies: ['Sketching', 'badminton', 'bubble tea runs'],
  goals: ['Pass her nursing boards next spring'],
  messages: {
   p_nora: 'I am bringing the watercolors on Thursday. We are painting the whole solar system.',
   p_malik: 'Blanket fort rematch on Tuesday. I am bringing the fairy lights.',
  },
 },
 p_price: {
  age: 44, job: 'Third grade teacher, Room 12 at Lincoln Elementary',
  hobbies: ['Gardening', 'mystery novels', 'choir'],
  goals: ['Get every reader past chapter books this year'],
  messages: {
   p_nora: 'Your volcano report made the whole class clap. Keep raising that hand.',
   p_jax: 'You helped our new student find his seat today. That is the Jax I know.',
  },
 },
 p_okafor: {
  age: 35, job: 'Substitute teacher and youth tutor',
  hobbies: ['Pickup soccer', 'chess club', 'history podcasts'],
  goals: ['A full time classroom of his own'],
  messages: {
   p_nora: 'Thanks for showing me where the art supplies live. You run a tight ship.',
   p_jax: 'Rematch at recess chess, my friend. You nearly had me last time.',
  },
 },
 p_jennings: {
  age: 51, job: 'School nurse at Lincoln Elementary',
  hobbies: ['Knitting', 'camping', 'mystery audiobooks'],
  goals: ['Every kid in a warm coat by December'],
  messages: {p_nora: 'Thank you for walking your friend to my office when she felt dizzy. Big heart.'},
 },
 p_holt: {
  age: 58, job: 'School bus driver, Route 9',
  hobbies: ['Model trains', 'classic cars', 'morning coffee with the depot crew'],
  goals: ['Another perfect safety record this year'],
  messages: {p_nora: 'Front seat has your name on it, early bird. Best hello on the whole route.'},
 },
 p_marcus: {
  age: 47, job: 'Parks and recreation staff, rec league soccer coach',
  hobbies: ['Pickup soccer', 'fishing', 'taco night'],
  goals: ['Every kid on the team touches the ball every game'],
  messages: {
   p_nora: 'Those passing drills are paying off. Saturday we work on your left foot.',
   p_jax: 'First goal of many, champ. Keep that follow through.',
   p_skye: 'Keep juggling that ball in the yard, Skye. Ten in a row by Friday, I believe it.',
   p_taylor: 'Homework first, then we talk team captain. You are closer than you think.',
  },
 },
 p_dana: {
  age: 39, job: 'Pharmacist',
  hobbies: ['Morning runs', 'crossword races', 'farmers markets'],
  goals: ['A carpool that actually runs on time'],
  messages: {
   p_jax: 'You and me, pancake Saturday. Extra blueberries, I already know.',
   p_nora: 'Jax says you are the fastest kid at recess. Come prove it at the park with us.',
  },
 },
 p_ray: {
  age: 41, job: 'Firefighter, Engine 23',
  hobbies: ['Woodworking', 'basketball', 'breakfast burritos'],
  goals: ['Help coach the team next season'],
  messages: {p_jax: 'Keep practicing those corner kicks, buddy. I will be in the stands cheering too loud.'},
 },
 p_whitfield: {
  age: 31, job: 'Art teacher at Lincoln Elementary',
  hobbies: ['Pottery', 'museum trips', 'photographing murals'],
  goals: ['A kiln for the art room'],
  messages: {
   p_nora: 'Your watercolor of the village is on the classroom wall. Everyone asks who painted it.',
   p_jax: 'Your clay fridge sculpture survived the kiln. Come see it shine.',
  },
 },
 p_evelyn: {
  age: 66, job: 'Retired church administrator',
  hobbies: ['Baking', 'porch gardening', 'gospel radio'],
  goals: ['Teach Jax the snickerdoodle recipe'],
  messages: {p_jax: 'Proud of you for scoring your first goal, sweetheart! Cookies are waiting.'},
 },
 p_simone: {
  age: 44, job: 'Elementary school counselor',
  hobbies: ['Piano duets', 'Sunday meal prep', 'mystery novels'],
  goals: ['Family game night every Friday'],
  messages: {
   p_avery: 'Saw you help your brother with his backpack this morning. That kindness is everything.',
   p_micah: 'Science fair volcano, you and me, this weekend. Goggles on.',
  },
 },
 p_denise: {
  age: 67, job: 'Retired choir director',
  hobbies: ['Dominoes', 'church bake sales', 'crochet'],
  goals: ['Teach the kids her sweet potato pie'],
  messages: {
   p_avery: 'Your piano scales are sounding like real songs now. Grandma hears it, baby.',
   p_micah: 'Second helping of greens and you still beat me at dominoes. Proud of you.',
  },
 },
 p_micah: {
  age: 11, job: 'Fifth grader',
  hobbies: ['Science kits', 'skateboarding', 'dominoes'],
  goals: ['Win the school science fair'],
  messages: {p_avery: 'You can borrow my markers for your poster. The good ones, even.'},
 },
 p_avery: {
  age: 9, job: 'Third grader',
  hobbies: ['Piano', 'double dutch', 'poster art'],
  goals: ['A first recital without looking down'],
  messages: {p_micah: 'Your volcano is going to win. I already told my whole class.'},
 },
 p_rosa: {
  age: 35, job: 'Bakery owner',
  hobbies: ['Empanada Sundays', 'salsa dancing', 'crosswords'],
  goals: ['A second counter at the market'],
  messages: {p_emma: 'Your abuela’s empanada recipe is waiting for your little hands on Sunday, mija.'},
 },
 p_tomas: {
  age: 37, job: 'Auto technician',
  hobbies: ['Soccer watch parties', 'model cars', 'hiking'],
  goals: ['Coach Emma’s first soccer season'],
  messages: {p_emma: 'You counted to one hundred in two languages. High five, mija.'},
 },
 p_cassandra: {
  age: 33, job: 'Costume designer for local theater',
  hobbies: ['Sewing', 'thrift flips', 'comic conventions'],
  goals: ['Design a full show on her own'],
  messages: {p_malik: 'Auntie found the superhero fabric. Your cape will be ready by Friday.'},
 },
 p_dwayne: {
  age: 45, job: 'Delivery route supervisor',
  hobbies: ['Bike repair', 'barbecue', 'old westerns'],
  goals: ['Ride the Slow Roll with Malik'],
  messages: {p_malik: 'That bike is getting too small because you are getting too big. We will fix that, champ.'},
 },
 p_oscar: {
  age: 59, job: 'Retired city gardener',
  hobbies: ['Tomato beds', 'porch dominoes', 'building birdhouses'],
  goals: ['A garden bed for every kid on the block'],
  messages: {p_malik: 'The tomatoes you helped me plant are taller than the fence. Come see.'},
 },
 p_felicia: {
  age: 43, job: 'Dance instructor',
  hobbies: ['Gym mornings', 'road trips', 'making playlists'],
  goals: ['Take the girls to see the ocean'],
  messages: {
   p_skye: 'Your cartwheel is officially better than mine. Gym mats stay out all week.',
   p_taylor: 'Loved your essay about Detroit. Your teacher is right, you have a voice.',
  },
 },
 p_taylor: {
  age: 14, job: 'Eighth grader',
  hobbies: ['Journaling', 'track practice', 'headphones on, world off'],
  goals: ['Make team captain this year'],
  messages: {p_skye: 'I will braid your hair before your meet if you stop taking my headphones.'},
 },
 p_skye: {
  age: 10, job: 'Fourth grader',
  hobbies: ['Cartwheels', 'soccer juggling', 'friendship bracelets'],
  goals: ['Ten juggles in a row'],
  messages: {p_taylor: 'You are the best big sister even when you are bossy. Mostly.'},
 },
}
