### T1 — cross-check S-ABSORB(T=1) vs "card lost from turn 1" (dead-card)

| deck | card removed | dead-card (model_dead) | ABSORB T=1, removal only | + 50-Spamton death bounty | + HP gain to the enemy | engine timing (enemy action of turn 1) |
|---|---|---:|---:|---:|---:|---:|
| deck chimere | Lame de la forêt | 4 792 | 4 777 | 4 792 | 4 777 | 4 965 |
| deck chimere | Chimère Brasse-chair | 1 920 | 1 904 | 1 919 | 1 904 | 1 870 |
| deck chimere | L'Œil des montagnes | 4 213 | 4 198 | 4 213 | 4 198 | 4 276 |
| deck chimere | Keria | 4 314 | 4 299 | 4 314 | 4 299 | 4 300 |
| anti-critiques | Hibernatus | 3 041 | 3 026 | 3 041 | 3 026 | 3 028 |
| anti-critiques | Chimère Brasse-chair | 2 681 | 2 665 | 2 680 | 2 665 | 2 685 |
| anti-critiques | Hippocampe Nimbé | 4 389 | 4 373 | 4 388 | 4 373 | 4 374 |
| anti-critiques | Keria | 3 802 | 3 786 | 3 801 | 3 786 | 3 787 |
| zéro critique | Murmures du Corail Noir | 2 626 | 2 611 | 2 626 | 2 611 | 2 639 |
| zéro critique | Prisonnière de la Machine | 2 961 | 2 917 | 2 932 | 2 917 | 2 945 |
| zéro critique | Hibernatus | 2 992 | 2 977 | 2 992 | 2 977 | 2 979 |
| zéro critique | Scorch, les Lézards Ignés | 2 417 | 2 401 | 2 416 | 2 401 | 2 660 |
| deck aleera | Aleera Mange-Cauchemars | 4 792 | 4 777 | 4 792 | 4 777 | 4 778 |
| deck aleera | Chimère Brasse-chair | 8 884 | 8 870 | 8 885 | 8 239 | 8 240 |
| deck aleera | L'Œil des montagnes | 6 199 | 6 187 | 6 202 | 6 187 | 6 252 |
| deck aleera | Keria | 8 626 | 8 610 | 8 625 | 8 256 | 8 257 |
| robuste A | Esprit Nature | 4 213 | 4 198 | 4 213 | 4 198 | 4 421 |
| robuste A | Lame de la forêt | 3 672 | 3 657 | 3 672 | 3 657 | 3 740 |
| robuste A | Keria | 3 880 | 3 865 | 3 880 | 3 865 | 3 867 |
| robuste A | Chimère Brasse-chair | 3 702 | 3 686 | 3 701 | 3 686 | 3 589 |
| robuste B | Scorch, les Lézards Ignés | 3 818 | 3 803 | 3 818 | 3 803 | 4 041 |
| robuste B | Sanglier Doré | 3 868 | 3 853 | 3 868 | 3 853 | 3 858 |
| robuste B | Chouette Polychrome | 3 868 | 3 853 | 3 868 | 3 853 | 3 854 |
| robuste B | Chimère Brasse-chair | 3 877 | 3 862 | 3 877 | 3 862 | 3 867 |

### T2 — S-ABSORB grid (T = 2, 4, 6, 8 × 4 positions), saved decks + robust alternatives

Cells: worst over the 4 positions / mean over the 4 positions, **net** score (engine score in brackets). Baseline in the 2nd column.

| deck | baseline | T=2 worst / mean | T=4 worst / mean | T=6 worst / mean | T=8 worst / mean | natural timing (T=7 if we play 1st, 8 if 2nd) worst | most valuable card (net / engine) |
|---|---:|---|---|---|---|---|---|
| deck chimere [103,238,156,117] | 8 018 | 520 / 1 866 (2 238 / 4 196) — Chimère | 713 / 2 925 (2 753 / 5 200) — Chimère | 2 013 / 3 942 (3 914 / 6 026) — Chimère | 3 844 / 5 109 (5 587 / 6 969) — Chimère | 2 910 (−64 %) [eng 4 692 (−41 %)] — Chimère | Chimère / Chimère |
| anti-critiques [12,238,27,117] | 6 989 | 335 / 908 (3 076 / 3 727) — Hibernatus | 859 / 1 869 (3 613 / 4 539) — Hippocampe | 2 227 / 3 158 (5 233 / 5 624) — Hippocampe | 2 508 / 3 795 (5 495 / 6 056) — Hippocampe | 2 438 (−65 %) [eng 5 493 (−21 %)] — Hippocampe | Hippocampe / Chimère |
| zéro critique [102,116,12,69] | 6 529 | 215 / 802 (2 918 / 3 128) — Hibernatus | 342 / 1 603 (3 265 / 3 944) — Prisonnière | 540 / 2 796 (4 069 / 4 809) — Prisonnière | 1 790 / 3 770 (5 109 / 5 632) — Prisonnière | 1 420 (−78 %) [eng 4 814 (−26 %)] — Prisonnière | Prisonnière / Murmures |
| deck aleera [231,238,156,117] | 12 847 | 3 679 / 5 535 (5 791 / 7 247) — Aleera | 5 772 / 7 531 (7 562 / 8 338) — Aleera | 11 572 / 11 860 (11 942 / 12 047) — Chimère | 12 560 / 12 702 (12 799 / 12 818) — Chimère | 12 145 (−5 %) [eng 12 428 (−3 %)] — Chimère | Aleera / Aleera |
| robuste A [3,103,117,238] | 7 626 | 1 602 / 1 982 (3 882 / 4 331) — Lame | 2 283 / 2 941 (4 342 / 5 123) — Chimère | 3 159 / 3 980 (5 184 / 5 991) — Lame | 4 112 / 4 859 (6 270 / 6 698) — Lame | 3 799 (−50 %) [eng 5 941 (−22 %)] — Lame | Lame / Chimère |
| robuste B [69,160,227,238] | 6 077 | 166 / 1 865 (4 048 / 4 288) — Sanglier | 525 / 2 759 (4 369 / 5 044) — Sanglier | 1 247 / 3 711 (4 940 / 5 561) — Sanglier | 1 804 / 4 456 (5 322 / 5 771) — Sanglier | 1 607 (−74 %) [eng 5 135 (−16 %)] — Sanglier | Sanglier / Sanglier |

Per position (mean over T = 2…8, net / engine):

| deck | pos 1 | pos 2 | pos 3 | pos 4 |
|---|---|---|---|---|
| deck chimere | Lame: 3 967 / 6 388 | Chimère: 1 773 / 3 623 | Œil: 3 797 / 6 036 | Keria: 4 306 / 6 344 |
| anti-critiques | Hibernatus: 2 071 / 4 853 | Chimère: 2 504 / 4 484 | Hippocampe: 1 555 / 4 936 | Keria: 3 601 / 5 675 |
| zéro critique | Murmures: 2 008 / 3 893 | Prisonnière: 756 / 3 922 | Hibernatus: 1 601 / 4 378 | Scorch: 4 607 / 5 320 |
| deck aleera | Aleera: 8 601 / 9 584 | Chimère: 9 781 / 10 366 | Œil: 9 173 / 9 982 | Keria: 10 074 / 10 517 |
| robuste A | E. Nature: 4 122 / 6 006 | Lame: 2 798 / 5 249 | Keria: 3 848 / 5 914 | Chimère: 2 994 / 4 974 |
| robuste B | Scorch: 4 991 / 5 680 | Sanglier: 936 / 4 670 | Chouette: 3 902 / 5 373 | Chimère: 2 962 / 4 942 |

### T3 — S-ABSORB sensitivity (natural timing), saved decks

| deck | absorbed card | net (default) | engine | engine, removal only (no HP gain) | net, absorber = focused enemy | net, AI does not re-plan |
|---|---|---:|---:|---:|---:|---:|
| deck chimere | Lame de la forêt | 5 065 | 7 188 | 7 188 | 5 095 | 5 065 |
| deck chimere | Chimère Brasse-chair | 2 910 | 4 692 | 4 692 | 2 913 | 2 910 |
| deck chimere | L'Œil des montagnes | 4 910 | 6 902 | 6 902 | 4 929 | 4 910 |
| deck chimere | Keria | 5 593 | 7 387 | 7 387 | 5 629 | 5 593 |
| anti-critiques | Hibernatus | 3 545 | 6 090 | 6 090 | 3 216 | 3 545 |
| anti-critiques | Chimère Brasse-chair | 3 894 | 5 676 | 5 676 | 3 390 | 3 894 |
| anti-critiques | Hippocampe Nimbé | 2 438 | 5 493 | 5 493 | 2 497 | 2 438 |
| anti-critiques | Keria | 4 601 | 6 467 | 6 467 | 4 395 | 4 601 |
| zéro critique | Murmures du Corail Noir | 3 191 | 4 888 | 4 888 | 3 235 | 3 192 |
| zéro critique | Prisonnière de la Machine | 1 420 | 4 814 | 4 814 | 1 431 | 1 420 |
| zéro critique | Hibernatus | 3 038 | 5 584 | 5 584 | 3 062 | 3 038 |
| zéro critique | Scorch, les Lézards Ignés | 6 529 | 6 529 | 6 529 | 6 529 | 6 529 |
| deck aleera | Aleera Mange-Cauchemars | 12 847 | 12 847 | 12 847 | 12 847 | 12 847 |
| deck aleera | Chimère Brasse-chair | 12 145 | 12 428 | 12 428 | 12 145 | 12 145 |
| deck aleera | L'Œil des montagnes | 12 331 | 12 484 | 12 769 | 12 331 | 12 331 |
| deck aleera | Keria | 12 413 | 12 525 | 12 809 | 12 413 | 12 413 |
| robuste A | Esprit Nature | 5 099 | 6 795 | 6 795 | 5 416 | 5 099 |
| robuste A | Lame de la forêt | 3 799 | 6 005 | 6 005 | 3 923 | 3 799 |
| robuste A | Keria | 5 135 | 6 985 | 6 985 | 5 208 | 5 135 |
| robuste A | Chimère Brasse-chair | 4 159 | 5 941 | 5 941 | 4 097 | 4 159 |
| robuste B | Scorch, les Lézards Ignés | 6 077 | 6 077 | 6 077 | 6 077 | 6 077 |
| robuste B | Sanglier Doré | 1 607 | 5 135 | 5 135 | 1 607 | 1 607 |
| robuste B | Chouette Polychrome | 5 954 | 6 076 | 6 076 | 5 978 | 5 954 |
| robuste B | Chimère Brasse-chair | 3 647 | 5 429 | 5 429 | 3 654 | 3 647 |

### T4 — other scenarios, saved decks + robust alternatives (score and % vs baseline)

| deck | baseline | CDR all cards @5 | CDR all @5+9 | CDR all, natural (4+9 / 5+10) | CDR 1 target, natural, worst target | SUS heal 32/turn engine / net | SUS heal 80/turn net | SUS revive 50 % engine / net | SETHP @4 highest-HP card | SETHP @4 worst target | SETHP natural (6/7), worst target |
|---|---:|---|---|---|---|---|---|---|---|---|---|
| deck chimere | 8 018 | 6 793 (−15 %) | 6 616 (−17 %) | 5 491 (−32 %) | 6 047 (−25 %) Chimère | +0 % / 7 151 (−11 %) | 5 827 (−27 %) | −0 % / 7 426 (−7 %) | 6 350 (−21 %) | 2 487 (−69 %) Chimère | 3 762 (−53 %) Chimère |
| anti-critiques | 6 989 | 5 401 (−23 %) | 4 257 (−39 %) | 4 717 (−33 %) | 6 163 (−12 %) Chimère | +3 % / 6 131 (−12 %) | 4 786 (−32 %) | −1 % / 5 865 (−16 %) | 5 439 (−22 %) | 4 366 (−38 %) Chimère | 5 415 (−23 %) Chimère |
| zéro critique | 6 529 | 6 051 (−7 %) | 6 051 (−7 %) | 6 067 (−7 %) | 5 035 (−23 %) Hibernatus | −2 % / 5 355 (−18 %) | 4 352 (−33 %) | −4 % / 5 065 (−22 %) | 3 497 (−46 %) | 3 497 (−46 %) Prisonnière | 4 394 (−33 %) Prisonnière |
| deck aleera | 12 847 | 6 640 (−48 %) | 6 616 (−48 %) | 8 750 (−32 %) | 9 789 (−24 %) Aleera | −11 % / 11 412 (−11 %) | 9 257 (−28 %) | −30 % / 8 996 (−30 %) | 9 646 (−25 %) | 7 168 (−44 %) Aleera | 11 973 (−7 %) Chimère |
| robuste A | 7 626 | 6 349 (−17 %) | 6 241 (−18 %) | 5 854 (−23 %) | 6 760 (−11 %) Keria | −1 % / 6 578 (−14 %) | 5 085 (−33 %) | −1 % / 6 465 (−15 %) | 5 480 (−28 %) | 4 585 (−40 %) Chimère | 5 560 (−27 %) Chimère |
| robuste B | 6 077 | 5 508 (−9 %) | 5 508 (−9 %) | 5 329 (−12 %) | 5 639 (−7 %) Sanglier | −0 % / 5 005 (−18 %) | 3 807 (−37 %) | −4 % / 4 562 (−25 %) | 5 510 (−9 %) | 4 940 (−19 %) Chimère | 5 486 (−10 %) Chimère |

### T5 — realistic set (natural cooldown timing, opponent picks our worst target, net score, clamped at baseline)

| deck | baseline | Veuve noire | Rayonnement | heal 32/turn | revive 50 % | Corne 25 | worst | mean drop | rank worst / mean (of 300 owned) |
|---|---:|---|---|---|---|---|---|---:|---|
| deck chimere | 8 018 | 2 910 (−64 %) | 6 047 (−25 %) | 7 151 (−11 %) | 7 426 (−7 %) | 3 762 (−53 %) | 2 910 | 31.9 % | 20 / 4 |
| anti-critiques | 6 989 | 2 438 (−65 %) | 6 163 (−12 %) | 6 131 (−12 %) | 5 865 (−16 %) | 5 415 (−23 %) | 2 438 | 25.6 % | 56 / 7 |
| zéro critique | 6 529 | 1 420 (−78 %) | 5 035 (−23 %) | 5 355 (−18 %) | 5 065 (−22 %) | 4 394 (−33 %) | 1 420 | 34.8 % | 160 / 82 |
| deck aleera | 12 847 | 12 145 (−5 %) | 9 789 (−24 %) | 11 412 (−11 %) | 8 996 (−30 %) | 11 973 (−7 %) | 8 996 | 15.4 % | n/a / n/a |
| robuste A | 7 626 | 3 799 (−50 %) | 6 760 (−11 %) | 6 578 (−14 %) | 6 465 (−15 %) | 5 560 (−27 %) | 3 799 | 23.5 % | 1 / 1 |
| robuste B | 6 077 | 1 607 (−74 %) | 5 639 (−7 %) | 5 005 (−18 %) | 4 562 (−25 %) | 5 486 (−10 %) | 1 607 | 26.6 % | 127 / 49 |

### T6 — top 15 of the 300 owned decks by realistic WORST case

| # | deck | baseline (rank) | realistic worst | realistic mean | mean drop | Veuve noire worst | Rayonnement | heal 32 | revive | Corne 25 | crit share of score |
|---:|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|
| 1 | E. Nature, Lame, Keria, Chimère [3,103,117,238] | 7 626 (#3) | 3 799 | 5 833 | 23.5 % | 3 799 (−50 %) Lame | −11 % | −14 % | −15 % | −27 % | 37.1 % |
| 2 | Scorch, Murmures, Œil, Chouette [69,102,156,227] | 6 845 (#10) | 3 693 | 5 159 | 24.6 % | 3 693 (−46 %) Chouette | −15 % | −19 % | −30 % | −13 % | 26.6 % |
| 3 | E. Eau, Scorch, Murmures, Chimère [2,69,102,238] | 6 523 (#17) | 3 676 | 5 258 | 19.4 % | 3 676 (−44 %) Chimère | −7 % | −16 % | −17 % | −13 % | 0.7 % |
| 4 | Scorch, Murmures, Chouette, Chimère [69,102,227,238] | 6 174 (#37) | 3 599 | 4 934 | 20.1 % | 3 599 (−42 %) Chimère | −6 % | −16 % | −26 % | −10 % | 6.4 % |
| 5 | Scorch, Murmures, Keria, Chimère [69,102,117,238] | 7 165 (#4) | 3 592 | 5 680 | 20.7 % | 3 592 (−50 %) Chimère | −13 % | −13 % | −14 % | −15 % | 15.7 % |
| 6 | Scorch, Prisonnière, Chouette, Chimère [69,116,227,238] | 5 694 (#127) | 3 376 | 4 612 | 19 % | 3 376 (−41 %) Chimère | −5 % | −20 % | −22 % | −6 % | 11.1 % |
| 7 | E. Eau, Scorch, Murmures, Chouette [2,69,102,227] | 6 134 (#42) | 3 370 | 4 675 | 23.8 % | 3 370 (−45 %) Murmures | −11 % | −17 % | −28 % | −18 % | 12.5 % |
| 8 | E. Eau, Œil, Chouette, Chimère [2,156,227,238] | 5 921 (#77) | 3 340 | 4 651 | 21.5 % | 3 340 (−44 %) Chimère | −7 % | −16 % | −27 % | −13 % | 16.9 % |
| 9 | Murmures, Œil, Chouette, Chimère [102,156,227,238] | 5 923 (#75) | 3 322 | 4 720 | 20.3 % | 3 322 (−44 %) Chimère | −7 % | −18 % | −21 % | −12 % | 17.5 % |
| 10 | E. Eau, Scorch, Chouette, Chimère [2,69,227,238] | 5 640 (#149) | 3 240 | 4 539 | 19.5 % | 3 240 (−43 %) Chimère | −7 % | −19 % | −18 % | −11 % | 11.3 % |
| 11 | Hibernatus, Scorch, Chouette, Chimère [12,69,227,238] | 6 040 (#58) | 3 058 | 4 763 | 21.1 % | 3 058 (−49 %) Hibernatus | −9 % | −17 % | −20 % | −11 % | 12.2 % |
| 12 | E. Feu, Œil, Chouette, Chimère [1,156,227,238] | 5 495 (#203) | 3 056 | 4 203 | 23.5 % | 3 056 (−44 %) Chimère | −7 % | −22 % | −33 % | −11 % | 20.2 % |
| 13 | E. Lumière, Œil, Chouette, Chimère [6,156,227,238] | 5 486 (#209) | 3 056 | 4 184 | 23.7 % | 3 056 (−44 %) Chimère | −8 % | −22 % | −33 % | −11 % | 22 % |
| 14 | Hippocampe, Keria, Œil, Chimère [27,117,156,238] | 7 789 (#2) | 3 036 | 5 520 | 29.1 % | 3 036 (−61 %) Hippocampe | −18 % | −11 % | −12 % | −44 % | 31.4 % |
| 15 | E. Eau, Murmures, Chouette, Chimère [2,102,227,238] | 5 837 (#90) | 2 983 | 4 471 | 23.4 % | 2 983 (−49 %) Chimère | −7 % | −24 % | −26 % | −12 % | 9.4 % |

### T7 — top 15 by realistic MEAN (average of the 5 realistic threats)

| # | deck | baseline (rank) | realistic worst | realistic mean | mean drop | Veuve noire worst | Rayonnement | heal 32 | revive | Corne 25 | crit share of score |
|---:|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|
| 1 | E. Nature, Lame, Keria, Chimère [3,103,117,238] | 7 626 (#3) | 3 799 | 5 833 | 23.5 % | 3 799 (−50 %) Lame | −11 % | −14 % | −15 % | −27 % | 37.1 % |
| 2 | Scorch, Murmures, Keria, Chimère [69,102,117,238] | 7 165 (#4) | 3 592 | 5 680 | 20.7 % | 3 592 (−50 %) Chimère | −13 % | −13 % | −14 % | −15 % | 15.7 % |
| 3 | Hippocampe, Keria, Œil, Chimère [27,117,156,238] | 7 789 (#2) | 3 036 | 5 520 | 29.1 % | 3 036 (−61 %) Hippocampe | −18 % | −11 % | −12 % | −44 % | 31.4 % |
| 4 | Lame, Chimère, Œil, Keria [103,238,156,117] | 8 018 (#1) | 2 910 | 5 459 | 31.9 % | 2 910 (−64 %) Chimère | −25 % | −11 % | −7 % | −53 % | 48.3 % |
| 5 | Murmures, Keria, Œil, Chimère [102,117,156,238] | 6 953 (#7) | 2 815 | 5 298 | 23.8 % | 2 815 (−60 %) Chimère | −19 % | −13 % | −6 % | −21 % | 29.5 % |
| 6 | E. Eau, Scorch, Murmures, Chimère [2,69,102,238] | 6 523 (#17) | 3 676 | 5 258 | 19.4 % | 3 676 (−44 %) Chimère | −7 % | −16 % | −17 % | −13 % | 0.7 % |
| 7 | Hibernatus, Chimère, Hippocampe, Keria [12,238,27,117] | 6 989 (#6) | 2 438 | 5 202 | 25.6 % | 2 438 (−65 %) Hippocampe | −12 % | −12 % | −16 % | −23 % | 10.2 % |
| 8 | Scorch, Murmures, Œil, Chouette [69,102,156,227] | 6 845 (#10) | 3 693 | 5 159 | 24.6 % | 3 693 (−46 %) Chouette | −15 % | −19 % | −30 % | −13 % | 26.6 % |
| 9 | Hippocampe, Lame, Keria, Chimère [27,103,117,238] | 6 997 (#5) | 2 469 | 5 019 | 28.3 % | 2 469 (−65 %) Hippocampe | −13 % | −14 % | −14 % | −36 % | 41.4 % |
| 10 | Scorch, Murmures, Chouette, Chimère [69,102,227,238] | 6 174 (#37) | 3 599 | 4 934 | 20.1 % | 3 599 (−42 %) Chimère | −6 % | −16 % | −26 % | −10 % | 6.4 % |
| 11 | Hibernatus, Scorch, Murmures, Chimère [12,69,102,238] | 6 232 (#31) | 2 971 | 4 912 | 21.2 % | 2 971 (−52 %) Hibernatus | −9 % | −16 % | −18 % | −10 % | 1.6 % |
| 12 | Hibernatus, Keria, Œil, Chimère [12,117,156,238] | 6 939 (#8) | 2 798 | 4 894 | 29.5 % | 2 798 (−60 %) Chimère | −19 % | −13 % | −12 % | −43 % | 24.8 % |
| 13 | Keria, Œil, Sanglier, Chimère [117,156,160,238] | 6 902 (#9) | 2 452 | 4 877 | 29.3 % | 2 452 (−64 %) Sanglier | −17 % | −14 % | −14 % | −37 % | 35 % |
| 14 | Baleine, Keria, Œil, Chimère [82,117,156,238] | 6 518 (#19) | 2 527 | 4 798 | 26.4 % | 2 527 (−61 %) Baleine | −12 % | −14 % | −14 % | −30 % | 32.9 % |
| 15 | E. Nature, Hippocampe, Keria, Chimère [3,27,117,238] | 6 775 (#11) | 2 094 | 4 793 | 29.2 % | 2 094 (−69 %) Hippocampe | −14 % | −15 % | −14 % | −34 % | 15.4 % |

### T8 — feature correlations (Pearson r over the 300 owned decks; drop % per realistic threat)

| feature | Veuve noire | Rayonnement | heal 32 | revive | Corne 25 | mean drop | baseline score |
|---|---:|---:|---:|---:|---:|---:|---:|
| crit share of score (1 − nocrit/normal) | −0.11 | 0.35 | −0.12 | −0.16 | 0.44 | 0.21 | 0.25 |
| single-card dependency (max loss-from-turn-1 %) | −0.16 | 0.44 | −0.19 | −0.48 | 0.76 | 0.23 | 0.32 |
| total HP | 0.62 | 0.12 | 0.08 | 0.18 | −0.18 | 0.40 | −0.18 |
| lowest card HP | −0.07 | −0.04 | 0.08 | −0.26 | 0.23 | −0.03 | 0.03 |
| # team-buff cards | −0.25 | 0.33 | −0.25 | −0.54 | 0.69 | 0.06 | 0.36 |
| # AoE damage cards | −0.40 | −0.41 | 0.03 | −0.19 | −0.13 | −0.54 | −0.06 |
| # abilities with CD ≥ 3 | 0.22 | 0.50 | −0.18 | −0.02 | 0.15 | 0.35 | 0.12 |
| # healing cards | −0.35 | 0.14 | −0.23 | −0.34 | 0.24 | −0.23 | 0.32 |
| contains Chimère | −0.29 | −0.12 | −0.10 | −0.69 | 0.32 | −0.38 | 0.17 |

### T9 — per card (owned cards, over the top-300 decks that contain them)

| # | card | HP | decks | absorbed at natural timing: drop net / engine | absorb no-op (card already dead) | "most valuable" share net / engine | Corne 25 target drop | Rayonnement target drop | mean drop of its decks |
|---:|---|---:|---:|---|---:|---|---:|---:|---:|
| 160 | Sanglier Doré | 900 | 74 | 80.3 % / 17.3 % | 0 % | 94.6 % / 45.9 % | 8.7 % | 7 % | 29.9 % |
| 82 | Baleine Farceuse | 1000 | 62 | 78.4 % / 19.2 % | 0 % | 85.5 % / 71 % | 9.4 % | 18.1 % | 31.4 % |
| 251 | Roi Ombre | 1000 | 12 | 78.3 % / 17.6 % | 0 % | 75 % / 33.3 % | 15.2 % | 7.4 % | 31.9 % |
| 158 | Lapin-Plume | 1000 | 1 | 77.1 % / 14.7 % | 0 % | 100 % / 0 % | 13.2 % | 0 % | 30.2 % |
| 153 | L'Inventeur | 1000 | 12 | 76.4 % / 15.6 % | 0 % | 75 % / 0 % | 10.5 % | 0 % | 30.1 % |
| 243 | Vivy | 1000 | 8 | 75.3 % / 15.2 % | 0 % | 100 % / 0 % | 10.5 % | 8.3 % | 29.4 % |
| 27 | Hippocampe Nimbé | 900 | 47 | 73.6 % / 20.5 % | 0 % | 74.5 % / 17 % | 16.2 % | 9.2 % | 29.1 % |
| 116 | Prisonnière de la Machine | 1000 | 26 | 62.5 % / 5.7 % | 5.8 % | 42.3 % / 0 % | 6.4 % | -0.4 % | 28.7 % |
| 12 | Hibernatus | 750 | 94 | 56.7 % / 11.9 % | 0 % | 22.3 % / 3.2 % | 7.8 % | 8.2 % | 28.1 % |
| 180 | Dragon Ciel | 700 | 7 | 55.3 % / 13 % | 0 % | 14.3 % / 0 % | 9.1 % | 1.7 % | 27.1 % |
| 103 | Lame de la forêt | 650 | 54 | 54.4 % / 16.2 % | 0 % | 27.8 % / 18.5 % | 10.5 % | 0 % | 28.4 % |
| 238 | Chimère Brasse-chair | 525 | 208 | 51.9 % / 21.1 % | 0.2 % | 26.9 % / 80.8 % | 22.8 % | 11.6 % | 27.8 % |
| 30 | Naissance d'Aldrin | 700 | 1 | 48.8 % / 6.7 % | 0 % | 0 % / 0 % | 1.9 % | -0.1 % | 32.2 % |
| 156 | L'Œil des montagnes | 600 | 68 | 45.8 % / 11.3 % | 0 % | 1.5 % / 0 % | 6.1 % | 0.9 % | 29.3 % |
| 259 | Dragon de la Cité Infernale | 550 | 3 | 41.8 % / 9.3 % | 0 % | 0 % / 0 % | 10.8 % | 3.7 % | 28.6 % |
| 117 | Keria | 550 | 104 | 39.7 % / 7.9 % | 0 % | 0 % / 0 % | 7.3 % | 8.5 % | 29.1 % |
| 102 | Murmures du Corail Noir | 500 | 83 | 32.1 % / 10.8 % | 27.2 % | 10.8 % / 24.1 % | 10.1 % | 0 % | 28.1 % |
| 4 | Esprit Terre | 500 | 18 | 29.7 % / 6.2 % | 25 % | 0 % / 0 % | 5.7 % | 0 % | 31.1 % |
| 3 | Esprit Nature | 500 | 44 | 28.2 % / 6.3 % | 27.3 % | 0 % / 0 % | 7.5 % | 0 % | 28.5 % |
| 227 | Chouette Polychrome | 500 | 91 | 26 % / 7.1 % | 38 % | 1.1 % / 9.9 % | 5.7 % | 4 % | 27.1 % |
| 2 | Esprit Eau | 500 | 63 | 18.9 % / 4.3 % | 50.1 % | 0 % / 0 % | 3.8 % | 0 % | 28.7 % |
| 6 | Esprit Lumière | 500 | 7 | 2.3 % / 0 % | 92.9 % | 0 % / 0 % | 0 % | 0 % | 30.2 % |
| 69 | Scorch, les Lézards Ignés | 350 | 100 | 2.3 % / 0.4 % | 90.9 % | 0 % / 0 % | 0.4 % | 0 % | 28.9 % |
| 1 | Esprit Feu | 500 | 6 | 0 % / 0 % | 100 % | 0 % / 0 % | 0 % | 0 % | 29.8 % |
| 5 | Esprit Ombre | 500 | 7 | 0 % / 0 % | 100 % | 0 % / 0 % | 0 % | 0 % | 32.2 % |
