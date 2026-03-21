// Salsa Masterclass Course Data — extracted from the "Multiply Your Moves" program
// Keyed by folder path (matching the tree structure in data.js)
const salsaCourseData = {
  title: "Multiply Your Moves",
  subtitle: "The Complete Salsa Program",
  intro: "Welcome to the ultimate salsa learning experience. This program is designed to enhance your technique, improve recall, and help you find flow in each dance.",

  // Course overview descriptions for each week (shown when browsing the week list)
  weeks: {
    "Week 1": { title: "Rotations", number: "01", color: "#e74c3c", description: "Rotational basics, 360 variations, back spot turn entries and exits. Build a foundation of rotational vocabulary." },
    "Week 2": { title: "Back to Back", number: "02", color: "#e67e22", description: "Cross body leads, turns, and barrel rolls — all while facing away from your partner." },
    "Week 3": { title: "Direction Changes", number: "03", color: "#f1c40f", description: "Checks, overturns, and reversals. Learn to change direction smoothly and dynamically." },
    "Week 4": { title: "Locks & Drops", number: "04", color: "#2ecc71", description: "Lock technique, drops, loops, and hair brushes across all turn types." },
    "Week 5": { title: "Hand Tosses", number: "05", color: "#3498db", description: "Toss connections, inside/outside tosses, and applying them in your social dancing." },
    "Week 6": { title: "Bringing It All Together", number: "06", color: "#9b59b6", description: "Problem solving challenges: create your own variations using everything you've learned." }
  },

  // Descriptions keyed by folder path (e.g. "Salsa Masterclass/Week 1/360 Variation")
  folders: {
    // ── GETTING STARTED ──
    "Salsa Masterclass/Week 1/Frameworks": {
      description: "The key frameworks leads and follows should be aware of: First half and second half, Follow is the focus (where is their weight?), 6 position diamond, Equivalent positions, 7 handholds + 3 levels."
    },
    "Salsa Masterclass/Week 1/Partner Work Exercises": {
      description: "Use these partner work exercises to improve your lead and follow fundamentals. Great as a warm-up or for focused fundamentals work.",
      tips: "0:08 — Follow the hand (frame) · 2:01 — Tension bridge · 3:20 — Arm position for turns · 4:49 — Torso connection · 6:02 — Blind following · 7:07 — Stay close to your partner"
    },
    "Salsa Masterclass/Week 1/Turn Drill On1": {
      description: "Daily practice turn drill for On1 timing."
    },
    "Salsa Masterclass/Week 1/Turn Drill On2": {
      description: "Daily practice turn drill for On2 timing."
    },
    "Salsa Masterclass/Week 1/Salsa-Basics-Warmup-On1": {
      description: "Salsa basics warmup for On1. Song: Ebbo — Sexteto Rumbahabana."
    },
    "Salsa Masterclass/Week 1/Salsa-Basics-Warmup-On2": {
      description: "Salsa basics warmup for On2. Song: Ebbo — Sexteto Rumbahabana."
    },

    // ── WEEK 1: ROTATIONS ──
    "Salsa Masterclass/Week 1/Week 1 Intro & Warmup": {
      description: "In week 1 we'll be using the following moves from the Salsa Program. If you don't have access, no worries — these moves were listed as prerequisites, so you should know them already.",
      prerequisites: {
        on1: ["Change of place", "Reverse cross body lead", "360", "Back spot turn", "Multiple back spot turns"],
        on2: ["Change of place (review the On1 version)", "Reverse cross body lead", "360", "Back spot turn", "Multiple back spot turns"]
      }
    },
    "Salsa Masterclass/Week 1/360 Variation": {
      description: "This 360 variation uses more of a ballroom frame to create an elegant feel. It's a great option during the intro and verse of the song, especially if the energy of the music is slow, smooth or romantic.",
      song: "Échale Madera — DJ Ricky Campenelli ft. Jimmy Bosch"
    },
    "Salsa Masterclass/Week 1/Rotation Reversals": {
      description: "Let's learn how to rotate and reverse directions to create a nice dynamic in our dancing. We'll start by rotating on the spot and then use a more linear cross body lead.",
      tips: "The back spot turn footwork will help in this lesson.",
      song: "Échale Madera — DJ Ricky Campenelli ft. Jimmy Bosch"
    },
    "Salsa Masterclass/Week 1/Back Spot Turn Entries": {
      description: "Let's explore some new ways to enter the back spot turn using the concept of equivalent positions.",
      tips: "In this lesson we use the change of place, back spot turn, reverse cross body and traveling turns.",
      song: "Échale Madera — DJ Ricky Campenelli ft. Jimmy Bosch"
    },
    "Salsa Masterclass/Week 1/Back Spot Turn Exits Follows Go Left": {
      description: "Now that we have some new ways to enter the back spot turn, let's explore some new ways to exit during the second half. You can also use these exits from a multiple back spot turn.",
      tips: "In this lesson we use the back spot turn, reverse cross body and reverse inside turn.",
      song: "Échale Madera — DJ Ricky Campenelli ft. Jimmy Bosch"
    },
    "Salsa Masterclass/Week 1/Back Spot Turn Exit Leads Go Left": {
      description: "We learned an exit where the follows turn left. Now let's learn an exit where the leads turn left on the second half.",
      song: "Échale Madera — DJ Ricky Campenelli ft. Jimmy Bosch"
    },
    "Salsa Masterclass/Week 1/Back Spot Turn Exit Inside Turn": {
      description: "This back spot turn exit is one of my favorites. It uses an overturn to change directions, creating a fun dynamic energy. Perfect for when the music is high energy.",
      tips: "We use the inside turn in this lesson.",
      song: "Échale Madera — DJ Ricky Campenelli ft. Jimmy Bosch"
    },
    "Salsa Masterclass/Week 1/Week 1 Challenge": {
      description: "Film a video social dancing together and play with the following: Use this week's moves, mix the entries and exits, interpret the music — use simple and smooth variations during the intro and verse, then increase the energy and dynamism in the montuno section.",
      tips: "We just filmed it once On1 to give you an idea. Not all the moves you learned are shown here."
    },

    // ── WEEK 2: BACK TO BACK ──
    "Salsa Masterclass/Week 2/Back to Back Cross Body Leads": {
      description: "You've all done cross body leads before, but have you tried them while facing away from your partner?",
      tips: "We'll use our knowledge of the cross body and reverse cross body for this lesson. Tip: to lead both of these back to back cross body leads the flick is on 5 (On1) or 2 (On2).",
      song: "Pobrecita — La Maxima 79"
    },
    "Salsa Masterclass/Week 2/Back Door Left Turn": {
      description: "Now let's learn how to do the left turn while facing away from your partner.",
      tips: "We use the left turn in this lesson.",
      song: "Pobrecita — La Maxima 79"
    },
    "Salsa Masterclass/Week 2/Back Door Inside & Outside Turns": {
      description: "Now let's learn the inside and outside turns facing away from your partner. The inside turn is a regular inside turn and the outside turn is a reverse outside turn.",
      tips: "We'll use your knowledge of the inside turn and reverse outside turn in this lesson.",
      song: "Pobrecita — La Maxima 79"
    },
    "Salsa Masterclass/Week 2/Back Door Right Turn": {
      description: "In this lesson we're going back to back with the right turn and spot turn.",
      tips: "Make sure you've practiced your spot turns.",
      song: "Pobrecita — La Maxima 79"
    },
    "Salsa Masterclass/Week 2/Back to Back Right Turn & Spot Turn": {
      description: "In this lesson we're going back to back with the right turn and spot turn.",
      tips: "Make sure you've practiced your spot turns.",
      song: "Pobrecita — La Maxima 79"
    },
    "Salsa Masterclass/Week 2/Inside & Outside Barrel Turns": {
      description: "Let's go back to back with our inside and outside turns.",
      tips: "We use the inside turn, outside turn, and reverse outside turn in this lesson.",
      song: "Pobrecita — La Maxima 79"
    },
    "Salsa Masterclass/Week 2/Double Turn With Barrel Finish": {
      description: "You've all done double turns. Now, let's learn how to end a double turn with a barrel roll.",
      tips: "We'll use the double turn in this lesson.",
      song: "Pobrecita — La Maxima 79"
    },
    "Salsa Masterclass/Week 2/Week 2 Challenge": {
      description: "For this week's challenge focus on two things: Interpret the music — match your moves to the energy of the song. Integrate everything you've learned in weeks 1 and 2 into a social dance.",
      song: "Pobrecita — La Maxima 79"
    },

    // ── WEEK 3: DIRECTION CHANGES ──
    "Salsa Masterclass/Week 3/Outside Turn With Early Check": {
      description: "For our first two direction changes we're going to use the outside turn.",
      tips: "When dancing On1 the check happens on the 5. When dancing On2 the check happens on the 2.",
      song: "El Hombre Increible — Marvin Santiago"
    },
    "Salsa Masterclass/Week 3/Outside Turn With Late Check": {
      description: "The late check variation of the outside turn direction change.",
      tips: "When dancing On1 the check is on the 7. When dancing On2 the check is on the 5.",
      song: "El Hombre Increible — Marvin Santiago"
    },
    "Salsa Masterclass/Week 3/Cross Body Reversal With Checks": {
      description: "Cross body lead reversal using check technique for direction changes.",
      song: "El Hombre Increible — Marvin Santiago"
    },
    "Salsa Masterclass/Week 3/Overturn on Third Step": {
      description: "This overturn goes right and happens on the third step of the cross body lead.",
      tips: "When dancing On1 this overturn happens on the 3. When dancing On2 this overturn happens on the 1.",
      song: "El Hombre Increible — Marvin Santiago"
    },
    "Salsa Masterclass/Week 3/Overturn on Fourth Step": {
      description: "This overturn goes left and happens on the fourth step of the cross body lead.",
      tips: "When dancing On1 this overturn happens on the 5. When dancing On2 this overturn happens on the 2.",
      song: "Conteo Regresivo — Gilberto Santa Rosa"
    },
    "Salsa Masterclass/Week 3/Spot Overturn": {
      description: "The spot overturn technique for direction changes.",
      tips: "We'll be using the Spot Turn in this lesson. Note: although the Spot Overturn looks like the Cape, it's more advanced and the timing is different.",
      song: "Conteo Regresivo — Gilberto Santa Rosa"
    },
    "Salsa Masterclass/Week 3/Week 3 Challenge": {
      description: "Choose a slower song to start with. Checks and overturns are tricky when the music is fast! Practice executing your direction changes smoothly. Add in Week 1 and 2 material — rotations and back to back stuff — as you social dance.",
      song: "Conteo Regresivo — Gilberto Santa Rosa"
    },

    // ── WEEK 4: LOCKS & DROPS ──
    "Salsa Masterclass/Week 4/Lock Technique & Warmup": {
      description: "Being successful with locks is all about technique. Stay close to your partner (forearm distance), relax your arms with elbows down, trace to maintain connection when you drop a hand.",
      tips: "Vocabulary: a \"lock\" is when you keep holding on to the hand. A \"drop\" is when you drop the hand (also called a \"hair brush\" when over someone's head). A \"loop\" or \"head loop\" is another name for a common lock that goes around the head. Warmup exercise at 3:47 (explanation) and 9:47 (demo)."
    },
    "Salsa Masterclass/Week 4/Right Turn With Locks": {
      description: "Right turn with lock technique.",
      song: "Beso a Beso — Grupo Gale"
    },
    "Salsa Masterclass/Week 4/Left Turn With Locks": {
      description: "Left turn with lock technique.",
      song: "Beso a Beso — Grupo Gale"
    },
    "Salsa Masterclass/Week 4/Inside Turn With Locks": {
      description: "Inside turn with lock technique.",
      song: "Beso a Beso — Grupo Gale"
    },
    "Salsa Masterclass/Week 4/Reverse Outside Turn With Locks": {
      description: "Reverse outside turn with lock technique.",
      song: "Beso a Beso — Grupo Gale"
    },
    "Salsa Masterclass/Week 4/Locks Combining It All": {
      description: "Combining all the different lock techniques you've learned across turn types."
    },
    "Salsa Masterclass/Week 4/Week 4 Challenge": {
      description: "This week's challenge is about combining all the different locks you just learned. As you social dance add in moves from previous weeks: Rotations (360s, spot turns with various entrances/exits), Back to back (back door turns, barrel turns), Direction changes (checks & overturns)."
    },

    // ── WEEK 5: HAND TOSSES ──
    "Salsa Masterclass/Week 5/Toss Connection Exercises": {
      description: "Three great connection exercises to start with: Switching from a handhold to a wrist/toss connection, Karate kid (wax on) circles to the inside, Karate kid (wax off) circles to the outside.",
      tips: "Try these exercises standing still first, then stepping in place to quick-quick-slow, and finally doing a basic. Improving your body movement (volume 2) will improve the rhythm of your hand tosses."
    },
    "Salsa Masterclass/Week 5/Outside Tosses": {
      description: "Outside toss technique. Since hand toss movements go with the movement of your body, reviewing body movement is highly recommended. Great body movement makes your partner work smoother, more rhythmical and easier to follow."
    },
    "Salsa Masterclass/Week 5/Inside Tosses To Lock Hammerlock": {
      description: "Inside tosses leading to lock and hammerlock positions."
    },
    "Salsa Masterclass/Week 5/Cross Body With Tosses": {
      description: "Cross body lead variations incorporating toss connections."
    },
    "Salsa Masterclass/Week 5/Applying Tosses In Your Dancing": {
      description: "Applying toss techniques in social dancing context.",
      tips: "0:14 What hand tosses are for + tips · 3:09 Toss to inside turn · 3:47 After a turn, toss from a lock · 5:53 After a turn, toss into a lock · 6:54 Lock with arm bounce · 9:17 Cross body options with right turn for lead · 11:28 Reverse cross body to wrap",
      song: "Tumba Mabo — Sonora Poncena"
    },
    "Salsa Masterclass/Week 5/Applying Tosses In Your Dancing Part II": {
      description: "More toss applications in social dancing.",
      tips: "0:08 Toss to hammerlock from single hand turn · 2:30 Karate kid: toss toss block to hammerlock (right hand) · 5:21 Same starting with left hand · 6:30 Toss to back to back copa/outside turn",
      song: "Tumba Mabo — Sonora Poncena"
    },

    // ── WEEK 6: BRINGING IT ALL TOGETHER ──
    "Salsa Masterclass/Week 6/Problem Solving Hammerlock Exits": {
      description: "It's time to bring everything you know together and solve some problems! Combine all your tools — your experience, knowledge of basic moves, 5 frameworks, and weekly themes — and come up with 6-10 solutions for exiting a hammerlock.",
      tips: "The goal: explore, create and problem solve to solidify neural connections. Don't watch the solutions video until you've tried ALL your assignments."
    },
    "Salsa Masterclass/Week 6/Problem Solving Inside Turn With Check": {
      description: "Use the 5 frameworks, weekly themes and basic moves to think of AT LEAST 4-6 variations (or aim high with 10+). You can vary the entrance or the exit (handholds, positions etc.).",
      tips: "You can do the inside turn with one check (the Wrap) or with two checks. The goal: explore, create and problem solve."
    },
    "Salsa Masterclass/Week 6/Problem Solving Copa": {
      description: "Use the 5 frameworks, weekly themes and your knowledge of basic moves to think of 4-6 copa variations. You can change the entrance, the amount of checks, the exit — whatever you like!",
      tips: "The goal: explore, create and problem solve to solidify neural connections."
    },
    "Salsa Masterclass/Week 6/Week 6 Challenge": {
      description: "It's time to bring everything you've learned together and social dance! As an exercise, include as much as you've learned as possible while connecting to the music: Week 1 rotations, Week 2 back to back, Week 3 direction changes, Week 4 locks and drops, Week 5 hand tosses, Week 6 vary your exits for common positions."
    },

    // ── WRAP UP ──
    "Salsa Masterclass/Wrap-Up": {
      description: "Congratulations! Here are ideas for continuing your training: 1) Go through the program at least 3 more times. 2) Do the intermediate and advanced combos until you can execute each cleanly. 3) Modify combos by mixing them together or adding your own ideas. 4) Watch favorite dancers on YouTube/Instagram and deconstruct what they're doing. 5) Create your own moves using everything you've learned. 6) Practice BODY MOVEMENT daily — this is the magic of salsa."
    }
  }
};
