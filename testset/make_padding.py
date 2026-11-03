"""Write demo/ledgerly/padding.yaml: about 2,000 off-topic chat messages (about 100k tokens) for experiment W5.

Data tooling only (no agent logic, no model calls). Deterministic: a fixed seed, so every run writes the same bytes.
Run: python3 testset/make_padding.py   (see demo/ledgerly/PADDING.md)

The padding is plausible small-team chatter (lunch, a broken build, holidays, the printer, design nitpicks,
client gossip, ...) spread over the seeded history period (1 Sep to 3 Nov 2026) and authored by the Ledgerly cast.
It must not touch any topic a case depends on, so BANNED below is checked against every template, every slot value
and every generated message; one hit fails the run.
"""
import random
import re
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "demo/ledgerly/padding.yaml"
SEED = 20261031
TARGET = 2000
FIRST_DAY, LAST_DAY = date(2026, 9, 1), date(2026, 11, 3)
ROWAN_LAST_DAY = date(2026, 9, 11)   # Rowan is away 14 Sep to 3 Nov (demo/README.md), so he only chats before then
LONDON = ZoneInfo("Europe/London")

# (label, regex). Matched case-insensitively against each message. Grouped by the case topic it protects.
BANNED = [
    ("reminders (T01, RT-OPU-2)", r"remind|overdue|chas(e|ing)|late pay"),
    ("direct debit / GoCardless (T02, RT-HAI-2)", r"debit|gocardless|\bdd\b|\bbank"),
    ("Stripe and cards (T02)", r"stripe|\bcards?\b"),
    ("payments and fees", r"\bpay|\bfees?\b|receipt|invoice|refund"),
    ("portal (T03, RT-HAI-1)", r"portal|download"),
    ("Xero / QuickBooks / sync (T04, T10, T24)", r"xero|quickbooks|\bqb\b|\bsync|\bcsv\b|integrat|export"),
    ("mobile apps (T07, RT-HAI-1, RT-FAB-5)", r"mobile|\bapps?\b|\bnative\b|\bphones?\b|\bios\b|android|responsive|\bweb\b|codebase|\bdesk"),
    ("weekends and onboarding days (T05, T21, RT-SON-2, RT-OPU-4)",
     r"week-?ends?|weekday|saturday|sunday|monday|tuesday|wednesday|thursday|friday"
     r"|\b(mon|tues?|wed|thu|thurs?|fri|sat|sun)\b|onboard|\bslots?\b|\bcalls?\b|calendar|\binvite|10\s?am"),
    ("agency counts and support (T12, RT-SON-3)", r"agenc|waiting list|capacity|\bhir(e|ing)\b|\bstaff|support|\bcover\b"),
    ("currencies and USD (T13)", r"currenc|\busd\b|\bgbp\b|\beur\b|euro|dollar|\bcents?\b|[$€£]|rounding|exchange rate"),
    ("pricing (RT-OPU-3)", r"pric|\bcost|cheap|expensive|per user|subscri|discount|\bfree\b"),
    ("surveys and interviews (T06, T17, RT-FAB-3)", r"survey|interview|questionnaire|feedback|research|case.?stud"),
    ("the launch (D5)", r"launch|announce|sign.?(in|up)|self.?serve"),
    ("PDF logos and templates (RT-FAB-5)", r"\bpdfs?\b|\blogos?\b|blurry|template|\blabels?\b"),
    ("issues #41 and #44 (T13, RT-SON-5, RT-FAB-5)", r"#\s?\d|\b4[14]\b"),
    ("Rowan's leave (job C)", r"rowan|\bleave\b|\baway\b|\boff\b|hand.?over|back from|returner|sabbatical|few weeks"),
    ("dark mode and the editor (T08)", r"dark mode|\bthemes?\b|\beditor\b"),
    ("Welsh / translation (T09)", r"welsh|cardiff|translat"),
    ("pilot, partners, roadmap, decisions",
     r"pilot|partner|fieldnote|harbour|\bpine\b|northbank|phase|roadmap|\bparked\b|decision|decid|confirmed|reopen"
     r"|\b[de][1-6]\b|planned|shipped|tested|sandbox|\blive\b|\bready\b|\bsso\b|crypto|two.?factor|\b2fa\b"),
    ("restrictions and people (T11, RT-OPU-4, RT-SON-2)", r"finance|month.?end|\bboard\b|family|\bleads?\b"),
    ("room, docs and the agent (T24, RT-SON-3, RT-OPU-3)",
     r"\bslack\b|e-?mail|mailing|\bbot\b|context keeper|ignore|system|\.md\b|status|tones?\b|recurring|timesheet|time entr|dispute"),
    ("Riverside topics", r"hackathon|sponsor|venue|mentor|\bprizes?\b|patchwork|student|\buni\b|kitchen|19:30|20:00|8\s?pm|9\s?pm"),
    ("case dates", r"\bnov\b|november|\bdec\b|december"),
]
BANNED_RE = [(label, re.compile(rx, re.I)) for label, rx in BANNED]

SLOTS = {
    "place": ["the noodle bar", "the falafel van", "Gino's", "the Turkish grill", "the sandwich shop on the corner",
              "the dumpling place", "the market stalls", "the pie shop", "the ramen bar", "the burrito counter",
              "the Lebanese deli", "the corner café", "Mama Thai", "the bagel shop"],
    "dish": ["katsu curry", "falafel wrap", "chicken shawarma", "pad thai", "mushroom risotto", "pork bao", "bowl of pho",
             "halloumi wrap", "steak pie", "bean burrito", "tuna melt", "spicy ramen", "jacket potato", "veggie lasagne"],
    "drink": ["flat white", "oat latte", "peppermint tea", "lemonade", "iced coffee", "builder's tea", "hot chocolate"],
    "cuisine": ["Korean", "Georgian", "Sri Lankan", "Peruvian", "Ethiopian", "Vietnamese", "Sicilian"],
    "homemade": ["chilli", "dal", "pasta bake", "shakshuka", "fried rice", "minestrone"],
    "n": ["5", "10", "15", "20"],
    "hour": ["12:15", "12:30", "12:45", "1", "1:30", "2", "3", "3:30"],
    "test": ["the date formatting snapshot", "the search box debounce test", "the settings page snapshot",
             "the avatar upload test", "the timezone offset test", "the big table sort test", "the clipboard copy test",
             "the redirect test", "the dropdown keyboard test", "the autosave test"],
    "tool": ["Node", "pnpm", "TypeScript", "the test runner", "ESLint", "Prettier", "Playwright", "Vite"],
    "version": ["22.11", "9.12", "5.6", "3.2", "8.0", "1.48"],
    "lang": ["TypeScript", "JSON", "YAML", "test", "config"],
    "mins": ["twenty", "thirty", "forty", "fifty"],
    "noise": ["grinding noise", "sad beeping", "clunk every ten seconds", "noise like a dying robot"],
    "error": ["PC LOAD LETTER", "error E-52", "paper jam in tray 2", "check the drum unit", "door open"],
    "count": ["thirty", "forty", "fifty", "twelve", "sixty"],
    "doc": ["the same slide deck", "a lasagne recipe", "a map of Cornwall", "the quiz answers", "someone's train tickets",
            "a knitting pattern", "a crossword"],
    "tint": ["faintly green", "streaky", "grey and ghostly", "with a smudge down the middle"],
    "days": ["five", "six", "eight", "ten"],
    "trip": ["Lisbon", "Porto", "the Lake District", "Cornwall", "Skye", "Copenhagen", "Seville", "Kraków", "Bruges",
             "Snowdonia", "Mallorca", "Edinburgh", "Valencia", "Ljubljana", "the Peak District", "Galway"],
    "when": ["October half-term", "the spring", "Easter", "March", "the new year", "early summer", "Christmas"],
    "font": ["Comic Sans", "Papyrus", "Helvetica", "Inter", "Georgia", "Futura", "Garamond", "Courier"],
    "colour": ["teal", "orange", "navy", "mint", "coral", "mustard", "lilac"],
    "biz": ["the bakery client", "the bike shop client", "the florist we work with", "the architecture studio downstairs",
            "the dentist next door", "the yoga place upstairs", "the brewery client", "the bookshop on the corner",
            "the bouldering gym client", "the pottery studio"],
    "thing": ["seasonal menu", "fleet of cargo bikes", "rooftop garden", "podcast", "loyalty scheme", "second shop"],
    "treat": ["brownies", "doughnuts", "cupcakes", "flapjacks", "cinnamon buns", "lemon drizzle", "shortbread"],
    "weather": ["eighteen degrees", "properly mild", "not even cold", "sunny"],
    "smell": ["fish curry", "burnt toast", "someone's gym bag", "popcorn", "fresh paint"],
    "letter": ["e", "n", "r", "k"],
    "pct": ["sixty", "seventy", "fifty-five"],
    "pub": ["the Crown", "the Fox and Anchor", "the Lamb", "the Ship", "the Railway Tavern"],
    "song": ["Bohemian Rhapsody", "Total Eclipse of the Heart", "Mr Brightside", "Dancing Queen", "Livin' on a Prayer"],
    "station": ["Clapham Junction", "Reading", "Stockport", "the tunnel", "Lewisham", "Didcot"],
    "area": ["the industrial estate", "three roundabouts", "the retail park", "a housing estate"],
    "show": ["the heist series", "the baking show", "that Danish crime drama", "the nature documentary",
             "the new detective one", "the space opera"],
    "book": ["the one about the lighthouse keeper", "that sci-fi trilogy", "the cookbook memoir", "the mountaineering one",
             "the Booker shortlist one", "the history of salt"],
    "pet": ["Doughbi-Wan", "Bready Mercury", "Gluten Morgenstern", "Clint Yeastwood", "Sir Loaf"],
    "animal": ["cat", "dog", "parrot", "tortoise"],
}

ALL = ["Kash", "Priya", "Sam", "Rowan"]
# Each thread: who may start it, two opener variants, replies, and closers (said by whoever started it).
# A reply or closer tagged "0:" or "1:" fits only that opener; untagged ones fit both.
THREADS = [
    # ── lunch and drinks ──
    dict(by=ALL, o=["Lunch run in {n} minutes, {place} or {place}? Shout if you want anything and I'll bring it back.",
                    "Heading to {place} at {hour}, back in half an hour. Put your orders in the thread and be specific."],
         r=["Yes please, a {dish} for me. No rush at all, I'm stuck in this for another hour anyway.",
            "I'm in. Can you grab me a {drink} too? I'll owe you one, as always.",
            "Could you get me whatever is vegetarian and not a sad salad? Thank you, you're a hero.",
            "Brought my own today, but save me a seat at the big table and I'll join you.",
            "{place} every time, the {dish} there is unbeatable and the portions are huge.",
            "Not today, I'm still full from that {dish} yesterday. I may never eat again."],
         c=["Back with the bags, they're on the big table. Grab yours before they go cold.",
            "They'd run out of {dish}, so you got a {dish} instead. Sorry, it was chaos in there."]),
    dict(by=ALL, o=["Has anyone tried the {dish} at {place}? The queue was out the door yesterday and I'm curious.",
                    "Anyone fancy {place} today? I could murder a {dish} after this morning."],
         r=["Their {dish} has gone downhill since they changed the menu, just saying. Get the {dish} instead.",
            "The queue at {place} was ten deep when I walked past, so maybe give it twenty minutes.",
            "0:It's worth the queue. Go before {hour} or they sell out of the good stuff.",
            "0:I had it last week and thought about it for days afterwards. Strong recommend.",
            "1:Count me in, but I need to be back by {hour} for a thing."],
         c=["Verdict: the hype is real. We're going back, possibly tomorrow.",
            "Overrated, but the {drink} was good, so the trip wasn't wasted."]),
    dict(by=ALL, o=["The new {cuisine} place by the station opened this week. Who's in for a look at lunchtime?",
                    "There's a {cuisine} pop-up at the market stalls this month. Lunch expedition at {hour}?"],
         r=["Ooh, {cuisine}. I read it's run by the people from the old market stall, so it should be great.",
            "Yes! I've been walking past it every morning and the smell is unreal.",
            "I'll come for the walk and a {drink}, I've got leftovers to get through.",
            "Go on then. I'll try whatever the person in front of me orders.",
            "In, as long as we're back by {hour}. Long afternoon ahead."],
         c=["Verdict on the {cuisine} place: excellent. Adding it to the lunch rotation.",
            "Ate far too much. If I'm quiet this afternoon, that's why."]),
    dict(by=ALL, o=["Bring-your-own lunch club again? I made far too much {homemade} last night and it won't eat itself.",
                    "Is it {place} today or leftovers? I genuinely can't choose and I need someone to tell me."],
         r=["0:Leftovers. Your {homemade} last time was better than anything on the high street.",
            "0:I'll swap you half a {dish} for some of that {homemade}. Fair trade.",
            "1:Go to {place}, you've earned it after this morning.",
            "1:Leftovers, then a walk to {place} for a {drink}. Best of both.",
            "Microwave queue is already three deep, just so you know."],
         c=["Leftovers won. The {homemade} was even better on day two.",
            "1:Went to {place} in the end. No regrets."]),
    dict(by=ALL, o=["Kettle's on, {drink} anyone? Last chance before I sit down for the afternoon.",
                    "Tea round. Hands up, and say how you take it, because I always forget."],
         r=["Me please, milk no sugar. Thank you!", "Oat for me if there's any left in the fridge.",
            "A {drink} would be lovely, thank you.", "I'm fine, I'm on my third already and I can hear colours.",
            "Strong enough to stand a spoon in, please."],
         c=["Mugs are on the side, help yourselves.", "Tea round done. I'm counting on someone else for the next one."]),
    dict(by=ALL, o=["Who left the milk out again? It's gone properly cheesy and the whole fridge knows about it.",
                    "We're down to the last bag of coffee beans. Adding it to the shopping list, shout if you want something else."],
         r=["0:Guilty. I'll get a fresh pint on the way in tomorrow, sorry.",
            "1:There's a spare bag of beans in the cupboard above the sink, behind the soup.",
            "1:Can we get the nice biscuits this time? The plain ones are a cry for help.",
            "1:Add oat milk too please, we've been out for a week.",
            "0:Not me, but I'll chuck it out. Holding my breath."],
         c=["1:Shopping is in. Beans, milk, and yes, the nice biscuits.", "0:Fridge smells normal again. Crisis over."]),
    dict(by=ALL, o=["The coffee machine is making the grinding noise again. I'm scared to touch it.",
                    "Has anyone descaled the coffee machine this year? It tastes of old pipes."],
         r=["0:I gave it a whack last time and it stopped. Very scientific, I know.",
            "1:The descaler tablets are in the drawer with the tea towels.",
            "0:It's the bean hopper, it jams when it's nearly empty. Top it up and it calms down.",
            "0:I've been using the cafetière since the noise started. No regrets.",
            "0:It's been doing that since the summer. I think it's just how it talks now."],
         c=["1:Descaled it. Brace yourselves for coffee that tastes like coffee.", "0:Topped up the beans and it's purring again."]),
    dict(by=ALL, o=["The good mugs have all vanished again. Check your bags, people, especially the big blue one.",
                    "Someone bought fancy biscuits and hid them behind the cereal. I found them. I'm sorry."],
         r=["0:Two of the mugs are on my shelf. I can explain, but I won't.",
            "1:Those biscuits were mine and I'm choosing to forgive you.",
            "0:The blue one is in the meeting room, it's been there for days.",
            "1:Biscuit hiding is a sign of a healthy team, honestly.",
            "0:I'll buy more mugs. Cheerful ones, so nobody can lose them."],
         c=["0:Mugs recovered: five. Mystery solved, mostly.", "1:Biscuits replaced, with interest."]),
    # ── the build ──
    dict(by=["Priya", "Priya", "Kash", "Sam"],
         o=["Main is red again: {test} fails on CI but passes locally. Anyone else seeing it?",
            "Flaky test of the day: {test}. Third time this week, and I'm starting to take it personally."],
         r=["Works on my machine, which I know is not helpful at all.",
            "That one's a timezone thing, it fails whenever CI runs in UTC after midnight.",
            "Retry fixed it for me, but we should quarantine that test before it bites again.",
            "Tried a clean clone and got the same failure, so it's not your machine.",
            "I'll pair with you on it after lunch if it's still red.",
            "Blame says it was me. Sorry, fixing it now."],
         c=["Fixed: {test} was relying on the order of a hash map. Green now.",
            "Quarantined it and opened a ticket. Main is green again."]),
    dict(by=["Priya", "Priya", "Kash", "Sam"],
         o=["Heads up, I bumped {tool} to {version} and the lockfile went wild. Rebasing now, give me ten minutes.",
            "Did anyone else's {tool} cache just evaporate? A fresh install took {mins} minutes."],
         r=["0:It's the {tool} upgrade. Pin it back to the old version and we'll look properly later.",
            "The {tool} changelog mentions exactly this. One more minor version should fix it.",
            "1:Mine too. I nuked the cache folder and it came back slowly but surely.",
            "0:Merge conflict in the lockfile, my favourite way to start the day.",
            "0:Rebase went fine for me after a clean install, so it's probably just a cache thing."],
         c=["0:Pinned {tool} for now. Proper fix next sprint, I promise.", "0:Lockfile is sane again. Sorry for the noise.",
            "1:Cache rebuilt. Installs are fast again."]),
    dict(by=["Priya", "Kash", "Sam"],
         o=["CI is queueing for ages this morning, the runners look stuck. Is it just me?",
            "Why does the build take {mins} minutes now? It used to be eight, and I miss those days."],
         r=["Someone turned on parallel tests and they're fighting over the same temp folder.",
            "0:Can we add a retry to that step? It's network noise, not our code.",
            "1:The cache key changed last week, so every build starts from scratch.",
            "0:The runners got restarted overnight. Should clear in a bit.",
            "I've opened a ticket for it so we stop rediscovering it every month."],
         c=["1:Build is back to eight minutes. The cache key was wrong all along.", "0:Runners are moving again."]),
    dict(by=["Priya", "Sam", "Kash"],
         o=["The linter now hates trailing commas in {lang} files. Who turned that rule on, and why?",
            "Docker build died on the base image pull again. Retrying, but this is getting old."],
         r=["0:Me, sorry. It was meant to be a warning, not an error. Reverting.",
            "1:The base image registry has been flaky all week. Mirror it and we'll stop caring.",
            "0:Trailing commas are good actually, but I'll accept a warning.",
            "0:Auto-fix sorts it out in one go if you run it before committing.",
            "1:Retried twice and it went through on the third. Not a fix, I know."],
         c=["0:Rule is a warning again. Peace restored.", "1:Mirrored the base image. Pulls are instant now."]),
    # ── printer and kit ──
    dict(by=ALL, o=["The printer is jammed again. I pulled out half a page and now it's making a {noise}.",
                    "Printer says '{error}'. Does anyone know what that means, or should I just walk to the library?"],
         r=["Unplug it, count to ten, plug it back in. Works every time.",
            "1:That error means the back door isn't shut properly. Push it until it clicks.",
            "0:Someone has put the A3 paper in the A4 tray again.",
            "I named it Gerald in the settings. It hasn't helped, but I feel closer to it.",
            "I've given up on it and gone to the library to print."],
         c=["Gerald lives. It was a paperclip.", "0:Unjammed. Two pages of someone's crossword were stuck in the back."]),
    dict(by=ALL, o=["Who printed {count} copies of {doc}? The tray is overflowing.",
                    "We're nearly out of toner and everything comes out {tint}."],
         r=["0:Mine, sorry. The print dialog froze and I kept clicking.",
            "1:There's spare toner on the top shelf of the stationery cupboard.",
            "1:The driver update last week broke it for half of us, so maybe it's that.",
            "0:Recycling box is by the door, I'll take the extras.",
            "1:I'll order more toner, and a second tray while I'm at it."],
         c=["1:New toner in. Everything is black again, as nature intended.", "0:Extras recycled. Tray is clear."]),
    dict(by=ALL, o=["Is the printer on the wifi or not? My laptop can't find it again.",
                    "Wifi is crawling. Is someone streaming in 4K?"],
         r=["0:It's on the guest network for some reason. I'll move it back.",
            "1:Speed test says 3 megabits. Nineties vibes.",
            "1:The router in the corner gets hot and sulks. Give it a minute.",
            "1:Plug in with a cable if you can, the wall ports work fine.",
            "1:Not me, but I did start a big file copy earlier. Pausing it."],
         c=["1:Router restarted. Back to normal speeds.", "0:Printer is back on the right network."]),
    dict(by=ALL, o=["My laptop chose to install updates in the middle of a screen share. Classic.",
                    "Battery is at {pct} percent after a full charge. I think it's time for a new one."],
         r=["0:Mine did the same last week, the updates took forty minutes.",
            "0:Turn on the quiet hours setting, it stops that happening.",
            "1:Get a new battery fitted, it's quicker than a new laptop.",
            "1:Mine has started to sound like a hairdryer, so I feel your pain.",
            "0:At least it waited until the interesting bit."],
         c=["1:New battery ordered. Until then I'm chained to the wall socket.", "0:Updates done. Everything moved, of course."]),
    dict(by=ALL, o=["Does anyone have a spare USB-C to HDMI dongle? Mine has vanished.",
                    "Keyboard has started double-typing the letter {letter}. Is that a coffee spill thing?"],
         r=["0:Top drawer by the window, there's a box of dongles of every kind.",
            "1:Compressed air, then hope.",
            "0:Check the box under the printer, there are adapters for everything.",
            "1:It's crumbs, almost always. Turn it upside down and give it a shake.",
            "0:I have two, borrow the white one."],
         c=["0:Found a dongle. It was in my coat the whole time.", "1:Shook it. Half a croissant came out. Fixed."]),
    dict(by=ALL, o=["New monitor arrived, and I've already lost an afternoon to arranging windows.",
                    "Trackpad has gone haunted. The cursor wanders around by itself."],
         r=["0:Get the one with the stand, your neck will thank you.",
            "1:Haunted trackpad is usually a dirty wrist rest. Weird but true.",
            "0:Two monitors is the dream. Three is just greedy.",
            "1:Ten minutes in a bag of rice fixed nothing for me, so skip that bit.",
            "0:Window tiling shortcuts changed my life. I'll show you."],
         c=["1:Cleaned it and the ghost has gone. Thanks.", "0:Windows arranged. Productivity is now theoretical."]),
    # ── office life ──
    dict(by=ALL, o=["Heating's on full blast and it's {weather} outside. Who has the thermostat key?",
                    "The lift is out again, so enjoy the stairs, everyone."],
         r=["0:The thermostat is behind the poster near the door, don't tell anyone.",
            "1:Stairs count as exercise, I'm calling it a workout.",
            "I've reported it to the building people. Again.",
            "0:Open a window, it's the only setting that works.",
            "1:Fourth time this month. The lift has a bigger social life than me."],
         c=["1:Lift is fixed, for now.", "0:Heating turned down. We can all lose the jumpers."]),
    dict(by=ALL, o=["Fridge clear-out at {hour}. Anything without a name on it goes in the bin.",
                    "The big meeting room smells of {smell}. Opening the windows."],
         r=["0:The yoghurt with no name was mine. Was.", "1:It was the {smell}, that one's on me.",
            "0:Please spare the hot sauce, it's been there since the spring and it's fine.",
            "0:Thanks for the warning, I'll grab my soup.", "1:Keep the windows open, it helps."],
         c=["0:Fridge done. We had three jars of the same mustard.", "1:Meeting room smells of nothing now. Victory."]),
    dict(by=ALL, o=["Someone's bike is blocking the rack again, the blue one with the basket.",
                    "The plant by the window is looking very sad. Is anyone watering it?"],
         r=["0:That's my bike, sorry, moving it now.", "1:I watered it last week. I think it just hates us.",
            "1:Plants like that want less water, not more. Give it a week.",
            "1:Move it to the sunny shelf, it'll perk up.", "0:Not my bike, but I know whose it is. I'll sort it."],
         c=["1:Plant has been moved to the sunny shelf. Fingers crossed.", "0:Bike moved, rack clear."]),
    dict(by=ALL, o=["Fire alarm test at {hour}, don't panic.",
                    "Window blind in the corner has given up completely. It's either fully down or on the floor."],
         r=["0:Thanks for the warning, I'll take my headphones out.",
            "1:I've reported the blind to the building people. Again.",
            "0:Last time the test lasted ten minutes. Bring a coat.",
            "1:The blind and I have an understanding. I don't touch it.",
            "0:Noted. I'll stop jumping out of my skin this time."],
         c=["0:Alarm test done, nobody jumped. Progress.", "1:Blind is fixed. It goes up and down like a normal blind."]),
    dict(by=["Kash", "Priya", "Sam"],
         o=["Roadworks outside again. The drilling starts at eight sharp.",
            "Builders next door are knocking through a wall today, so expect thumping all afternoon."],
         r=["Noise-cancelling headphones are the best thing I ever bought.",
            "0:The drilling has a rhythm if you listen. I'm not saying it's good.",
            "I'll work from the café on the corner for a bit.",
            "Quiet room is empty if anyone needs it.",
            "My plants are vibrating. Is that normal?"],
         c=["0:Drilling stopped. Silence has never sounded so good.", "1:Wall is down. Back to normal noise."]),
    # ── holidays, commute, weather ──
    dict(by=ALL, o=["Booked {days} days in {trip} for {when}. Already counting down.",
                    "Thinking about {trip} or {trip} for {when}. Convince me either way."],
         r=["0:Jealous. Bring back snacks, the local kind.",
            "Go to the bakery near the old bridge, best pastries of my life.",
            "We did {trip} two years ago, it rained every single day and we still loved it.",
            "1:{trip}, no contest. The food alone is worth it.",
            "Rent a bike for a day there, it's flat and gorgeous.",
            "Pack a raincoat, trust me, whatever the forecast says."],
         c=["Booked it. Thanks for the tips, everyone.", "1:Going with {trip}. Tips still welcome."]),
    dict(by=ALL, o=["Anyone been to {trip}? Looking for tips, ideally ones that don't involve hiking.",
                    "Flights to {trip} for {when} are wild this year. Train it is, I think."],
         r=["Get the early train, it's half empty.", "The ferry over is the best bit, honestly.",
            "There's a tiny museum of clocks there that's weirdly brilliant.",
            "Eat at the market, not the restaurants on the main square.",
            "0:Go in {when}, it's quieter and the light is lovely."],
         c=["0:Noted all of it. Clock museum is top of the list.", "1:Train booked. Snacks sorted."]),
    dict(by=ALL, o=["Don't forget to put your Christmas holidays in the shared sheet, so we don't all vanish at once.",
                    "Lovely week in {trip}. My tan lasted about a day after landing."],
         r=["0:Put it in the sheet so we don't all go at once.", "0:Added mine. I've taken the dull days, you're welcome.",
            "1:Welcome home! Photos or it didn't happen.", "1:Did you go to the bakery near the old bridge?",
            "0:The sheet is in the shared drive, under admin."],
         c=["0:Added mine to the sheet.", "1:Photos are in the thread. Mostly of food."]),
    dict(by=ALL, o=["Trains are a mess this morning, signal failure at {station}. Might be late.",
                    "Bus driver took a detour through {area} for no reason. Scenic, I suppose."],
         r=["Same here, stuck outside {station} for twenty minutes.", "Get the earlier one, it's always emptier.",
            "Cycle in, it's quicker and the hills build character.", "No rush, nothing is on fire here.",
            "1:At least you got a tour. Mine just stopped in a field."],
         c=["Made it in. Only forty minutes late, a personal best.", "Here at last. Coffee first."]),
    dict(by=ALL, o=["Cycled in through the rain and I'm soaked to the bone. Anyone have a spare jumper?",
                    "Fog so thick this morning I nearly walked into a lamppost."],
         r=["0:There's a hoodie in the lost property box, it's clean, I think.",
            "Enjoy the sunshine when it comes, rain again by four.",
            "0:Radiator by the window is the warmest, hang your coat there.",
            "0:Mudguards. I say this as a friend.", "1:The fog is lifting now, at least."],
         c=["0:Dry now, thanks for the hoodie.", "1:Fog's gone and it's actually sunny. Make it make sense."]),
    dict(by=ALL, o=["It's actually sunny. Taking my laptop to the bench in the park at lunch.",
                    "First proper autumn morning. Leaves everywhere and I love it."],
         r=["0:Bring a jumper, it's colder in the shade than it looks.", "0:I'll join you with a {drink}.",
            "1:Autumn is the best season and I will not be taking questions.",
            "0:The squirrels in that park are fearless, guard your sandwich.", "Enjoy it, rain is due tomorrow."],
         c=["0:A squirrel stole a crisp. Worth it.", "0:Back inside. Vitamin D levels restored.",
            "1:Kicked a pile of leaves on the way to lunch. Zero regrets."]),
    # ── design nitpicks ──
    dict(by=["Sam", "Sam", "Kash", "Priya"],
         o=["Tiny thing, but the kerning on the office door sign is driving me up the wall.",
            "Somebody used a drop shadow on the meeting room booking sheet and I need to talk about it."],
         r=["I genuinely can't unsee it now. Thanks.", "1:Drop shadows are back in, I read it somewhere very official.",
            "0:The gap between the second and third letter is a crime, you're right.",
            "Send me the file and I'll tidy the spacing.", "0:Make a sign of your own and stick it over the top."],
         c=["0:Printed a new door sign. Nobody will notice, and that's the point.", "1:Shadow removed. I feel lighter."]),
    dict(by=["Sam", "Sam", "Kash", "Priya"],
         o=["Whoever made the quiz night poster, I love it, but please never use {font} again.",
            "The careers page uses {font} for headings and {font} for the body. Bold choice."],
         r=["0:It's {font}, I picked it because it was the only one installed.",
            "1:Two fonts is fine. Three is a ransom note.", "1:I'll pair with you on it, ten minutes tops.",
            "0:To be fair, it got people to the quiz.", "1:I'd pick {font} for both and be done."],
         c=["Swapped the {font} for something calmer. Peace restored.", "1:Careers page fonts fixed. One typeface, two weights."]),
    dict(by=["Sam", "Sam", "Kash", "Priya"],
         o=["Can we agree on one shade of {colour} for the team slides? I've counted four.",
            "The icons in our wiki sidebar are three different sizes. I'll fix them if nobody minds."],
         r=["0:{colour} number two is the correct one and I'll die on this hill.",
            "1:Fixed the wiki icons. Took three minutes and a lot of sighing.",
            "0:I'll make a tiny style guide for the slides. One page, I promise.",
            "1:Please do, they've bothered me for months.", "0:Four shades is a palette, not a mistake. Kidding."],
         c=["0:One-page slide guide is in the wiki. It's mostly a list of things not to do.", "1:Icons all match now."]),
    dict(by=["Sam", "Kash", "Priya"],
         o=["Hot take: rounded corners on everything has gone too far.",
            "Why does the meeting room screen stretch every slide to 4:3?"],
         r=["0:Rounded corners are a lifestyle choice, let them be.",
            "1:It's the HDMI adapter. The blue one does 16:9, the grey one doesn't.",
            "0:Sharp corners are coming back, mark my words.",
            "1:I hid the grey adapter so nobody uses it again.", "0:Some corners deserve to be round. Not all."],
         c=["1:Grey adapter retired. Slides are the right shape again.", "0:Compromise reached: slightly rounded."]),
    # ── client gossip and neighbours ──
    dict(by=ALL, o=["Heard {biz} is moving into the old post office on the high street.",
                    "Ran into the people from {biz} at the street market, they're opening a {thing}."],
         r=["0:Good for them, their old place was tiny.", "I knew it, they've been hinting for months.",
            "0:The old post office has those gorgeous windows, they'll love it.",
            "Their founder is lovely, she once lent me an umbrella in the rain.",
            "0:That's a big move. Hope it goes well for them."],
         c=["1:Their {thing} opens this month. I'll report back.", "0:Walked past and the new place looks great."]),
    dict(by=ALL, o=["{biz} sent us a box of {treat} to say thanks. They're on the big table.",
                    "Saw the founder of {biz} on the local news last night, talking about their new {thing}."],
         r=["0:Saved you some {treat}, the rest went fast.", "0:Good for them, their {treat} are amazing.",
            "1:She was brilliant on the news, very calm.", "1:Their {thing} sounds great, I'll take a look.",
            "0:Can we be their favourite forever please."],
         c=["0:The {treat} lasted eleven minutes. A new record.", "0:Sent them a thank-you note from all of us.",
            "1:Looked up their {thing}. It's genuinely good."]),
    dict(by=ALL, o=["Apparently {biz} renamed itself again. That's the third new name in two years.",
                    "Overheard in the lift: {biz} is getting an office dog. I'm thrilled."],
         r=["0:Third name? Someone there really loves a naming workshop.",
            "1:An office dog would improve this building by a lot.",
            "0:I liked the second name best, for the record.", "1:Please let it be a sausage dog.",
            "0:They'll be back to the first name by spring, you watch."],
         c=["1:Update: the dog is a sausage dog called Waffle.", "0:New name is on the door. It's fine. It's fine."]),
    # ── social and hobbies ──
    dict(by=ALL, o=["Quiz night at {pub} later this month. Who's in? We need a better team name than last time.",
                    "Bowling or mini golf for the end-of-quarter social? Votes in the thread."],
         r=["0:In! Team name suggestion: Quizteama Aguilera.", "1:Mini golf, bowling shoes are a crime.",
            "0:We came fourth last time, which is our best ever.",
            "Put me down, as long as it's not too late, I need my sleep.", "Count me in. I'll bring {treat}."],
         c=["0:We came third. Third! Drinks on the team kitty.", "1:Mini golf wins. Booking it now."]),
    dict(by=ALL, o=["Birthday cake in the meeting room at {hour}. Keep it quiet.",
                    "Puzzle club at lunch: the thousand-piece one of a lighthouse is on the big table."],
         r=["0:Bringing my own candles this time.", "1:I'll do the sky bits of the puzzle, nobody else has the patience.",
            "0:What kind of cake? Asking for my diet.", "0:I'll keep the birthday person busy until then.",
            "1:Edges first, always. This is non-negotiable."],
         c=["0:Cake is gone. Happy birthday from all of us.", "1:Puzzle done. One piece missing, and I have suspicions."]),
    dict(by=ALL, o=["Karaoke recap: we do not speak of the {song} incident.",
                    "Anyone want to join a five-a-side team? We're one short."],
         r=["0:I was there and I'm still not over it.", "0:That was the best night of the year and you know it.",
            "1:I'm in for five-a-side, but I can only play in goal.", "0:There is video. I'm not saying who has it.",
            "1:My knees say no, my heart says yes."],
         c=["1:Five-a-side: we lost seven nil, but the vibes were immaculate.", "0:The video has been deleted. Probably."]),
    dict(by=ALL, o=["Finished {show} last night. That ending, wow. No spoilers in here please.",
                    "Anyone reading anything good? I need a holiday book."],
         r=["0:No spoilers, I'm two episodes behind.", "1:Read {book}, I couldn't put it down.",
            "0:{show} was so good. That second episode though.", "1:I have a stack, come and raid my shelf.",
            "0:The ending made me shout at the telly."],
         c=["1:Started {book} on your advice. Hooked.", "Finished it. I have so many questions."]),
    dict(by=ALL, o=["Sourdough update: the starter survives. Named it {pet}.",
                    "Took up pottery. Made a bowl. It's more of a plate."],
         r=["0:Your starter has a better social life than me.", "1:A plate is just a confident bowl.",
            "0:Bring some bread in, for science.", "1:Pottery is so calming. Until the wheel wins.",
            "0:{pet} is an excellent name."],
         c=["0:Bread attempt three: edible. {pet} is thriving.", "1:Made a mug. It holds tea. Barely."]),
    dict(by=ALL, o=["Ran my first 10k without stopping. Legs are not speaking to me.",
                    "My {animal} brought a whole sock in from somebody's garden. No idea whose."],
         r=["0:Well done! Ice bath and pizza, that's the recovery plan.",
            "1:I'd watch a whole series about your {animal}'s crimes.", "1:Photos of the {animal} or it didn't happen.",
            "0:Next stop, half marathon. No pressure.", "1:Return the sock with a note. Be the change."],
         c=["0:Legs are speaking again. Mostly complaining.", "1:The sock's owner has been found. They want it back."]),
    dict(by=ALL, o=["Dog-sitting my sister's spaniel this week, apologies in advance for the hair on my jumper.",
                    "Whoever put the sea shanties on the office speaker: thank you, and also why?"],
         r=["0:Bring the spaniel in. I'm begging.", "1:Sea shanties are a mood. Keep them on.",
            "0:Lint roller in the drawer by the door.", "1:That was me. I'm not sorry.",
            "1:Can we have a playlist rota? I'll do the first week."],
         c=["0:Spaniel has gone home. The office is less fluffy.", "1:Playlist rota is in the wiki."]),
]

TAILS = [
    " Anyway, back to it.", " Will report back.", " Not urgent at all.", " Just me?", " Classic.",
    " Sorry for the noise in here.", " Small mercies.", " Wish me luck.", " That's all, carry on.",
    " More soon.", " I'll stop now.", " Honestly, what a day.", " Happy to be told I'm wrong.",
    " This is the most important thing I'll say today.", " Back to the grind after this.",
]

# Second thoughts people tack on to a message (people rarely say just one thing).
ASIDES = [
    "Unrelated, but {place} has a {dish} special this week and I'm thinking about it constantly.",
    "Also, whoever left the {treat} on the big table: thank you, you're a legend.",
    "Side note: the quiz at {pub} is back on later this month if anyone wants in.",
    "Also, has anyone seen my green scarf? It's been missing since the last quiz night.",
    "Separately, the window cleaners are here, so smile at the glass.",
    "Oh, and the {smell} smell in the meeting room is finally gone.",
    "Also, I finished {book} and I need someone to talk to about it.",
    "PS: the lift is behaving today, enjoy it while it lasts.",
    "In other news, the plant by the window has a new leaf.",
    "Also, {trip} is now top of my list for {when}, thanks to all of you.",
    "PS: there's a spare {drink} on the side if anyone wants it before it goes cold.",
    "Also, the stationery cupboard has been restocked, and someone bought the good pens.",
    "Unrelated: I've started a sweepstake on when the lift breaks next. Entries in the thread.",
    "Side note: {pub} has a new menu and the chips are now triangular, for some reason.",
    "Also, I've finally learned the names of all the pigeons on the windowsill.",
    "PS: someone's umbrella has been in the stand since the summer. Claim it or it becomes communal.",
    "Oh, and the café on the corner remembered my order today. I feel seen.",
    "Separately, I've fixed the wobbly chair in the meeting room with a folded beer mat.",
    "Also, the {cuisine} cookbook in the shelf by the window is excellent, borrow it.",
    "Unrelated, but I've watched three episodes of {show} on the train this week.",
    "PS: the building is testing the hot water tomorrow morning, so expect cold taps.",
    "Also, I'm doing a coffee order from the good place at three, put your name down.",
    "Side note: the noticeboard by the door has a lost cat poster. Keep an eye out.",
    "Unrelated: the {show} finale is out, so no spoilers in here please.",
    "Also, the printer is making the {noise} again, I'm just letting you know.",
    "Separately, my {animal} has been extremely naughty today and I need to vent.",
    "PS: the {homemade} recipe I mentioned is in the wiki, under food.",
    "Oh, and the {cuisine} place by the station is doing a lunch deal, apparently.",
    "Also, I've put a new {font} poster up by the door, purely to start an argument.",
    "Unrelated: {biz} has a new sign and it's actually lovely.",
]


def banned_hits(text: str) -> list:
    return [label for label, rx in BANNED_RE if rx.search(text)]


def guard_library() -> list:
    """Check every template and slot value up front, so a banned word can't hide behind the random draw."""
    pieces = [("tail", t) for t in TAILS] + [("aside", re.sub(r"\{\w+\}", "x", t)) for t in ASIDES]
    pieces += [(f"slot {k}", v) for k, vs in SLOTS.items() for v in vs]
    for i, th in enumerate(THREADS):
        pieces += [(f"thread {i}", re.sub(r"\{\w+\}", "x", untag(t))) for part in "orc" for t in th[part]]
    return [f"{where}: {label}: {text!r}" for where, text in pieces for label in banned_hits(text)]


def untag(template: str) -> str:
    return template[2:] if template[:2] in ("0:", "1:") else template


def fits(template: str, opener: int) -> bool:
    return template[:2] not in ("0:", "1:") or template[0] == str(opener)


def fill(template: str, rng: random.Random, memory: dict) -> str:
    """Fill {slots}. Within one conversation a slot keeps its first value (the same lunch place, the same font),
    except that a slot repeated in one template ("{trip} or {trip}") gets distinct values."""
    used = {}

    def pick(m):
        name = m.group(1)
        taken = used.setdefault(name, [])
        value = memory.get(name) if not taken and name in memory else rng.choice([v for v in SLOTS[name] if v not in taken])
        memory.setdefault(name, value)
        taken.append(value)
        return value

    text = re.sub(r"\{(\w+)\}", pick, untag(template))
    return text[0].upper() + text[1:]


def working_days() -> list:
    days, d = [], FIRST_DAY
    while d <= LAST_DAY:
        if d.weekday() < 5:
            days.append(d)
        d += timedelta(days=1)
    return days


def generate(rng: random.Random) -> list:
    days = working_days()
    seen, msgs = set(), []

    def say(template: str, memory: dict) -> str:
        text = ""
        for _ in range(25):   # avoid exact repeats where the pools allow
            text = fill(template, rng, memory)
            if rng.random() < 0.5:
                text += " " + fill(rng.choice(ASIDES), rng, {})
            elif rng.random() < 0.4:
                text += rng.choice(TAILS)
            if text not in seen:
                break
        seen.add(text)
        return text

    while len(msgs) < TARGET:
        day = rng.choice(days)
        cast = ["Kash", "Priya", "Sam"] + (["Rowan"] if day <= ROWAN_LAST_DAY else [])
        th = rng.choice(THREADS)
        starter = rng.choice([a for a in th["by"] if a in cast] or cast)
        t = datetime.combine(day, time(8, 40), LONDON) + timedelta(minutes=rng.randrange(0, 9 * 60))
        memory, oi = {}, rng.randrange(len(th["o"]))
        pool = [r for r in th["r"] if fits(r, oi)]
        closers = [c for c in th["c"] if fits(c, oi)]
        convo = [{"at": t, "author": starter, "text": say(th["o"][oi], memory), "parent": None}]
        replies = rng.sample(pool, k=min(len(pool), rng.choice([0, 1, 1, 2, 2, 3, 3, 4])))
        for r in replies:
            t += timedelta(minutes=rng.randrange(1, 25), seconds=rng.randrange(0, 60))
            who = rng.choice([a for a in cast if a != convo[-1]["author"]])
            convo.append({"at": t, "author": who, "text": say(r, memory), "parent": convo[0]})
        if replies and closers and rng.random() < 0.45:
            t += timedelta(minutes=rng.randrange(5, 60))
            convo.append({"at": t, "author": starter, "text": say(rng.choice(closers), memory), "parent": convo[0]})
        for m in convo[1:]:
            if rng.random() < 0.12:   # some replies are posted top-level, as people do
                m["parent"] = None
        msgs += convo

    msgs = sorted(msgs[:TARGET], key=lambda m: (m["at"], m["author"]))
    for i, m in enumerate(msgs, 1):
        m["id"] = f"pad-{i:04d}"
    for m in msgs:
        parent = m.pop("parent")
        m["thread"] = parent["id"] if parent else None
    return msgs


def render(msgs: list) -> str:
    lines = [
        f"# GENERATED by testset/make_padding.py (seed {SEED}). Do not edit; re-run the generator.",
        "# Off-topic padding for #ledgerly-pilot (experiment W5): merge into chat-history.yaml's messages by `at`.",
        "# None of it touches a topic the test cases depend on (the generator's BANNED list).",
        "room: ledgerly-pilot",
        "messages:",
    ]
    for m in msgs:
        lines += [f"  - id: {m['id']}", f"    at: {m['at'].isoformat()}", f"    author: {m['author']}"]
        if m["thread"]:
            lines.append(f"    thread: {m['thread']}")
        text = m["text"].replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'    text: "{text}"')
    return "\n".join(lines) + "\n"


def main() -> int:
    problems = guard_library()
    msgs = generate(random.Random(SEED))
    for m in msgs:
        problems += [f"{m['id']}: {label}: {m['text']!r}" for label in banned_hits(m["text"])]
        if m["author"] == "Rowan" and m["at"].date() > ROWAN_LAST_DAY:
            problems.append(f"{m['id']}: Rowan posts during his leave")
    if problems:
        print("FAIL: banned topics in the padding:\n" + "\n".join(problems[:20]), file=sys.stderr)
        return 1

    body = render(msgs)
    data = yaml.safe_load(body)   # round-trip: the file must parse, ids unique, threads point backwards
    index = {m["id"]: m for m in data["messages"]}
    assert len(index) == len(data["messages"]) == TARGET
    assert all(index[m["thread"]]["at"] < m["at"] for m in data["messages"] if m.get("thread"))
    OUT.write_text(body)

    size = len(body.encode())
    repeats = TARGET - len({m["text"] for m in msgs})
    print(f"wrote {OUT.relative_to(ROOT)}: {TARGET} messages, {size:,} bytes, ~{size // 4:,} tokens at 4 chars/token")
    print(f"  {msgs[0]['at']:%d %b} to {msgs[-1]['at']:%d %b %Y}, {sum(1 for m in msgs if m['thread'])} threaded replies, "
          f"{repeats} repeated texts; authors: "
          + ", ".join(f"{a} {sum(1 for m in msgs if m['author'] == a)}" for a in ALL))
    return 0


if __name__ == "__main__":
    sys.exit(main())
