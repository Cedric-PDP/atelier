// SPAM 1.21 stress driver (engine 36e2c03d5b7bf4a1). 1.21 minified names (checked by content):
//   J = one match (1.20 q), Y = score (1.20 J), le = opponent phase (1.20 de), T = element profile,
//   xe = card DPS (1.20 Se), d = 9 profiles, o = params (o.opponent.dpsByTurn), ht = evaluator.
// MODE: 'check' | 'duel:none' | 'duel:rec' | 'incident' | 'sens'
(()=>{
const MODE="duel:none";
const OUR=[{"key":"103-117-156-238","label":"chimere","named":true,"nums":[103,238,156,117],"ids":["f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","6598bdc6-b5f4-47a8-be11-761422965f71","3c5cc4d2-1692-4da7-81ae-eb853c91327f","5721ea5f-5978-4328-8874-28abc283f6b8"],"topRank":20},{"key":"3-103-117-238","label":"robA","named":true,"nums":[3,103,117,238],"ids":["50807128-85af-472d-b2f7-59737a9a03b4","f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","5721ea5f-5978-4328-8874-28abc283f6b8","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"12-27-117-238","label":"anticrit","named":true,"nums":[12,238,27,117],"ids":["6428d28c-4897-46e4-bcc5-5165484fda2b","6598bdc6-b5f4-47a8-be11-761422965f71","9f744687-461b-493e-9a9a-408906fafbde","5721ea5f-5978-4328-8874-28abc283f6b8"]},{"key":"12-69-102-116","label":"zerocrit","named":true,"nums":[102,116,12,69],"ids":["def9a313-f174-4e62-b4b8-1086d28bd09e","feb27db8-e8a5-4ff3-8c30-fc76927965ee","6428d28c-4897-46e4-bcc5-5165484fda2b","e030e28b-0ba3-4c9e-932b-d7c333cadf26"]},{"key":"69-160-227-238","label":"robB","named":true,"nums":[69,160,227,238],"ids":["e030e28b-0ba3-4c9e-932b-d7c333cadf26","76ecb89a-1b3d-4683-b076-5ea3fc20f91a","4dc96cb5-d342-4ef6-8808-fcc79c63690b","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"69-102-117-238","label":"r3","named":true,"nums":[69,102,117,238],"ids":["e030e28b-0ba3-4c9e-932b-d7c333cadf26","def9a313-f174-4e62-b4b8-1086d28bd09e","5721ea5f-5978-4328-8874-28abc283f6b8","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"2-69-102-238","label":"r4","named":true,"nums":[2,69,102,238],"ids":["edfb6bd4-3ac4-420c-bb25-91c9005dea80","e030e28b-0ba3-4c9e-932b-d7c333cadf26","def9a313-f174-4e62-b4b8-1086d28bd09e","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"69-102-156-227","label":"e2b","named":true,"nums":[69,102,156,227],"ids":["e030e28b-0ba3-4c9e-932b-d7c333cadf26","def9a313-f174-4e62-b4b8-1086d28bd09e","3c5cc4d2-1692-4da7-81ae-eb853c91327f","4dc96cb5-d342-4ef6-8808-fcc79c63690b"]},{"key":"3-103-156-238","label":"e1b","named":true,"nums":[3,103,156,238],"ids":["50807128-85af-472d-b2f7-59737a9a03b4","f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","3c5cc4d2-1692-4da7-81ae-eb853c91327f","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"12-103-117-238","label":"e1c","named":true,"nums":[12,103,117,238],"ids":["6428d28c-4897-46e4-bcc5-5165484fda2b","f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","5721ea5f-5978-4328-8874-28abc283f6b8","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"2-69-82-102","label":"nochim","named":true,"nums":[2,69,82,102],"ids":["edfb6bd4-3ac4-420c-bb25-91c9005dea80","e030e28b-0ba3-4c9e-932b-d7c333cadf26","2d03ec53-9ab2-46c7-a2e9-7aa6e264d97e","def9a313-f174-4e62-b4b8-1086d28bd09e"]},{"key":"27-117-156-238","label":"hip","named":true,"nums":[27,117,156,238],"ids":["9f744687-461b-493e-9a9a-408906fafbde","5721ea5f-5978-4328-8874-28abc283f6b8","3c5cc4d2-1692-4da7-81ae-eb853c91327f","6598bdc6-b5f4-47a8-be11-761422965f71"],"topRank":33},{"key":"103-117-180-238","label":"dc1","named":true,"nums":[180,103,117,238],"ids":["977ee5ba-0054-418b-b9f6-d99946f4272c","f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","5721ea5f-5978-4328-8874-28abc283f6b8","6598bdc6-b5f4-47a8-be11-761422965f71"],"topRank":19},{"key":"3-117-180-238","label":"dc2","named":true,"nums":[180,3,117,238],"ids":["977ee5ba-0054-418b-b9f6-d99946f4272c","50807128-85af-472d-b2f7-59737a9a03b4","5721ea5f-5978-4328-8874-28abc283f6b8","6598bdc6-b5f4-47a8-be11-761422965f71"],"topRank":3},{"key":"69-102-180-238","label":"dc3","named":true,"nums":[180,69,102,238],"ids":["977ee5ba-0054-418b-b9f6-d99946f4272c","e030e28b-0ba3-4c9e-932b-d7c333cadf26","def9a313-f174-4e62-b4b8-1086d28bd09e","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"117-156-180-238","label":"dc4","named":true,"nums":[180,238,156,117],"ids":["977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71","3c5cc4d2-1692-4da7-81ae-eb853c91327f","5721ea5f-5978-4328-8874-28abc283f6b8"],"topRank":9},{"key":"3-103-180-238","label":"dc5","named":true,"nums":[180,3,103,238],"ids":["977ee5ba-0054-418b-b9f6-d99946f4272c","50807128-85af-472d-b2f7-59737a9a03b4","f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","6598bdc6-b5f4-47a8-be11-761422965f71"],"topRank":2},{"key":"69-117-180-238","label":"dc6","named":true,"nums":[180,69,117,238],"ids":["977ee5ba-0054-418b-b9f6-d99946f4272c","e030e28b-0ba3-4c9e-932b-d7c333cadf26","5721ea5f-5978-4328-8874-28abc283f6b8","6598bdc6-b5f4-47a8-be11-761422965f71"],"topRank":27},{"key":"3-103-117-180","label":"top01","named":false,"topRank":1,"nums":[3,103,117,180],"ids":["50807128-85af-472d-b2f7-59737a9a03b4","f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","5721ea5f-5978-4328-8874-28abc283f6b8","977ee5ba-0054-418b-b9f6-d99946f4272c"]},{"key":"3-103-156-180","label":"top04","named":false,"topRank":4,"nums":[3,103,156,180],"ids":["50807128-85af-472d-b2f7-59737a9a03b4","f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","3c5cc4d2-1692-4da7-81ae-eb853c91327f","977ee5ba-0054-418b-b9f6-d99946f4272c"]},{"key":"117-153-180-238","label":"top05","named":false,"topRank":5,"nums":[117,153,180,238],"ids":["5721ea5f-5978-4328-8874-28abc283f6b8","73b0f0c5-6f48-44e2-a789-678b4f0d2dde","977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"103-117-156-180","label":"top06","named":false,"topRank":6,"nums":[103,117,156,180],"ids":["f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","5721ea5f-5978-4328-8874-28abc283f6b8","3c5cc4d2-1692-4da7-81ae-eb853c91327f","977ee5ba-0054-418b-b9f6-d99946f4272c"]},{"key":"69-153-180-238","label":"top07","named":false,"topRank":7,"nums":[69,153,180,238],"ids":["e030e28b-0ba3-4c9e-932b-d7c333cadf26","73b0f0c5-6f48-44e2-a789-678b4f0d2dde","977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"3-153-180-238","label":"top08","named":false,"topRank":8,"nums":[3,153,180,238],"ids":["50807128-85af-472d-b2f7-59737a9a03b4","73b0f0c5-6f48-44e2-a789-678b4f0d2dde","977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"153-180-227-238","label":"top10","named":false,"topRank":10,"nums":[153,180,227,238],"ids":["73b0f0c5-6f48-44e2-a789-678b4f0d2dde","977ee5ba-0054-418b-b9f6-d99946f4272c","4dc96cb5-d342-4ef6-8808-fcc79c63690b","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"153-156-180-238","label":"top11","named":false,"topRank":11,"nums":[153,156,180,238],"ids":["73b0f0c5-6f48-44e2-a789-678b4f0d2dde","3c5cc4d2-1692-4da7-81ae-eb853c91327f","977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"3-117-153-180","label":"top12","named":false,"topRank":12,"nums":[3,117,153,180],"ids":["50807128-85af-472d-b2f7-59737a9a03b4","5721ea5f-5978-4328-8874-28abc283f6b8","73b0f0c5-6f48-44e2-a789-678b4f0d2dde","977ee5ba-0054-418b-b9f6-d99946f4272c"]},{"key":"27-69-180-238","label":"top13","named":false,"topRank":13,"nums":[27,69,180,238],"ids":["9f744687-461b-493e-9a9a-408906fafbde","e030e28b-0ba3-4c9e-932b-d7c333cadf26","977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"103-153-180-238","label":"top14","named":false,"topRank":14,"nums":[103,153,180,238],"ids":["f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","73b0f0c5-6f48-44e2-a789-678b4f0d2dde","977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"3-27-180-238","label":"top15","named":false,"topRank":15,"nums":[3,27,180,238],"ids":["50807128-85af-472d-b2f7-59737a9a03b4","9f744687-461b-493e-9a9a-408906fafbde","977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"117-180-227-238","label":"top16","named":false,"topRank":16,"nums":[117,180,227,238],"ids":["5721ea5f-5978-4328-8874-28abc283f6b8","977ee5ba-0054-418b-b9f6-d99946f4272c","4dc96cb5-d342-4ef6-8808-fcc79c63690b","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"3-27-103-180","label":"top17","named":false,"topRank":17,"nums":[3,27,103,180],"ids":["50807128-85af-472d-b2f7-59737a9a03b4","9f744687-461b-493e-9a9a-408906fafbde","f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","977ee5ba-0054-418b-b9f6-d99946f4272c"]},{"key":"2-117-180-238","label":"top18","named":false,"topRank":18,"nums":[2,117,180,238],"ids":["edfb6bd4-3ac4-420c-bb25-91c9005dea80","5721ea5f-5978-4328-8874-28abc283f6b8","977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"27-103-156-180","label":"top21","named":false,"topRank":21,"nums":[27,103,156,180],"ids":["9f744687-461b-493e-9a9a-408906fafbde","f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","3c5cc4d2-1692-4da7-81ae-eb853c91327f","977ee5ba-0054-418b-b9f6-d99946f4272c"]},{"key":"3-103-153-180","label":"top22","named":false,"topRank":22,"nums":[3,103,153,180],"ids":["50807128-85af-472d-b2f7-59737a9a03b4","f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","73b0f0c5-6f48-44e2-a789-678b4f0d2dde","977ee5ba-0054-418b-b9f6-d99946f4272c"]},{"key":"117-153-156-238","label":"top23","named":false,"topRank":23,"nums":[117,153,156,238],"ids":["5721ea5f-5978-4328-8874-28abc283f6b8","73b0f0c5-6f48-44e2-a789-678b4f0d2dde","3c5cc4d2-1692-4da7-81ae-eb853c91327f","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"12-117-180-238","label":"top24","named":false,"topRank":24,"nums":[12,117,180,238],"ids":["6428d28c-4897-46e4-bcc5-5165484fda2b","5721ea5f-5978-4328-8874-28abc283f6b8","977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"103-117-153-180","label":"top25","named":false,"topRank":25,"nums":[103,117,153,180],"ids":["f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","5721ea5f-5978-4328-8874-28abc283f6b8","73b0f0c5-6f48-44e2-a789-678b4f0d2dde","977ee5ba-0054-418b-b9f6-d99946f4272c"]},{"key":"12-153-180-238","label":"top26","named":false,"topRank":26,"nums":[12,153,180,238],"ids":["6428d28c-4897-46e4-bcc5-5165484fda2b","73b0f0c5-6f48-44e2-a789-678b4f0d2dde","977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"117-153-180-227","label":"top28","named":false,"topRank":28,"nums":[117,153,180,227],"ids":["5721ea5f-5978-4328-8874-28abc283f6b8","73b0f0c5-6f48-44e2-a789-678b4f0d2dde","977ee5ba-0054-418b-b9f6-d99946f4272c","4dc96cb5-d342-4ef6-8808-fcc79c63690b"]},{"key":"3-4-180-238","label":"top29","named":false,"topRank":29,"nums":[3,4,180,238],"ids":["50807128-85af-472d-b2f7-59737a9a03b4","b95d5704-625c-44f1-8425-de843adcca56","977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"27-103-180-238","label":"top30","named":false,"topRank":30,"nums":[27,103,180,238],"ids":["9f744687-461b-493e-9a9a-408906fafbde","f55c5b0a-9493-4e19-b3fe-5eac4c281a1f","977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"3-6-180-227","label":"top31","named":false,"topRank":31,"nums":[3,6,180,227],"ids":["50807128-85af-472d-b2f7-59737a9a03b4","2a1ead5f-4012-4705-a289-29f080f159dd","977ee5ba-0054-418b-b9f6-d99946f4272c","4dc96cb5-d342-4ef6-8808-fcc79c63690b"]},{"key":"1-3-180-238","label":"top32","named":false,"topRank":32,"nums":[1,3,180,238],"ids":["18bca5cf-7aa1-421c-85ec-4ed0b6a8ca70","50807128-85af-472d-b2f7-59737a9a03b4","977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"102-117-180-238","label":"top34","named":false,"topRank":34,"nums":[102,117,180,238],"ids":["def9a313-f174-4e62-b4b8-1086d28bd09e","5721ea5f-5978-4328-8874-28abc283f6b8","977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"3-69-180-238","label":"top35","named":false,"topRank":35,"nums":[3,69,180,238],"ids":["50807128-85af-472d-b2f7-59737a9a03b4","e030e28b-0ba3-4c9e-932b-d7c333cadf26","977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"12-117-153-238","label":"top36","named":false,"topRank":36,"nums":[12,117,153,238],"ids":["6428d28c-4897-46e4-bcc5-5165484fda2b","5721ea5f-5978-4328-8874-28abc283f6b8","73b0f0c5-6f48-44e2-a789-678b4f0d2dde","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"2-3-180-238","label":"top37","named":false,"topRank":37,"nums":[2,3,180,238],"ids":["edfb6bd4-3ac4-420c-bb25-91c9005dea80","50807128-85af-472d-b2f7-59737a9a03b4","977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"3-30-180-238","label":"top38","named":false,"topRank":38,"nums":[3,30,180,238],"ids":["50807128-85af-472d-b2f7-59737a9a03b4","f57456c7-c2ed-458c-9417-13a9bbb4aec8","977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"3-180-227-238","label":"top39","named":false,"topRank":39,"nums":[3,180,227,238],"ids":["50807128-85af-472d-b2f7-59737a9a03b4","977ee5ba-0054-418b-b9f6-d99946f4272c","4dc96cb5-d342-4ef6-8808-fcc79c63690b","6598bdc6-b5f4-47a8-be11-761422965f71"]},{"key":"3-5-180-238","label":"top40","named":false,"topRank":40,"nums":[3,5,180,238],"ids":["50807128-85af-472d-b2f7-59737a9a03b4","9c93fa79-43e5-4b2b-888d-386de286fd2c","977ee5ba-0054-418b-b9f6-d99946f4272c","6598bdc6-b5f4-47a8-be11-761422965f71"]}];
const META=[{"key":"44-136-188-231","src":"tier121#1","nums":[44,136,188,231],"ids":["a1fc5c55-684a-40df-9476-d6e40a5731fb","1d3d896d-c640-4d88-a1af-059f39546c60","3c38bd35-20d2-4369-971c-9216d21da76a","40416045-b820-4d2c-96f9-34f87d99ac25"],"names":["Léviathan des Cieux","Souverain des Chutes d'Éther","Commando Gerz","Aleera Mange-Cauchemars"]},{"key":"127-136-231-263","src":"tier121#4","nums":[127,136,231,263],"ids":["b42ca72a-df32-43af-b23d-5256525d1665","1d3d896d-c640-4d88-a1af-059f39546c60","40416045-b820-4d2c-96f9-34f87d99ac25","d27faf84-0a03-4c16-b744-c555cd6f1edc"],"names":["Spectre Canin","Souverain des Chutes d'Éther","Aleera Mange-Cauchemars","Paguroniyx"]},{"key":"177-197-231-236","src":"tier121#11","nums":[177,197,231,236],"ids":["3ec973d6-c20f-4455-82d4-92dce5d22a52","0d26bb73-4cd0-44fb-aba6-5b14d93d6249","40416045-b820-4d2c-96f9-34f87d99ac25","0c8c383b-2207-4d18-b378-4f2a3795a58e"],"names":["Moxilys, la Fredonneuse","Codex des Maux Ancestraux","Aleera Mange-Cauchemars","Apprentie de la Mort"]},{"key":"69-136-156-229","src":"tier121#12","nums":[69,136,156,229],"ids":["e030e28b-0ba3-4c9e-932b-d7c333cadf26","1d3d896d-c640-4d88-a1af-059f39546c60","3c5cc4d2-1692-4da7-81ae-eb853c91327f","9e974935-3da9-4acf-9507-a79cbd80bfb2"],"names":["Scorch, les Lézards Ignés","Souverain des Chutes d'Éther","L'Œil des montagnes","Maître Amphibian"]},{"key":"69-97-117-236","src":"tier121#13","nums":[69,97,117,236],"ids":["e030e28b-0ba3-4c9e-932b-d7c333cadf26","ea7ee071-9031-496c-9e3c-a45659f8402f","5721ea5f-5978-4328-8874-28abc283f6b8","0c8c383b-2207-4d18-b378-4f2a3795a58e"],"names":["Scorch, les Lézards Ignés","Pyro","Keria","Apprentie de la Mort"]},{"key":"4-17-85-188","src":"tier121#18","nums":[4,17,85,188],"ids":["b95d5704-625c-44f1-8425-de843adcca56","a2426557-7553-496e-9e48-7b397cf1e77d","f5a09cd7-5e6e-4196-907b-07408c3106b8","3c38bd35-20d2-4369-971c-9216d21da76a"],"names":["Esprit Terre","Croqueur de Fruits Verdoyant","Bleu-mange-cailloux","Commando Gerz"]},{"key":"3-45-106-180","src":"tier121#19","nums":[3,45,106,180],"ids":["50807128-85af-472d-b2f7-59737a9a03b4","1a638c99-8a8f-4d14-b3a2-3d53a7d80553","ebeacfd6-0436-4d76-b45b-a6bba75b7e3a","977ee5ba-0054-418b-b9f6-d99946f4272c"],"names":["Esprit Nature","Aldrin & Gorakar","L'Épine d'Amour","Dragon Ciel"]},{"key":"2-178-226-260","src":"tier121#20","nums":[2,178,226,260],"ids":["edfb6bd4-3ac4-420c-bb25-91c9005dea80","cb80482d-48d0-48e8-8149-6b99107a3a55","dd59d65a-3c14-49a1-898e-afb8dd01618f","2a61029e-6d9d-47f2-b2ed-68730e842ced"],"names":["Esprit Eau","Épine Médusine","Apprenti Évocateur","Le compagnon des esprits"]},{"key":"72-174-206-262","src":"tier121#24","nums":[72,174,206,262],"ids":["a6fd8277-3861-41f1-94c2-d5430a8eb994","a0ce442e-65ac-4e50-86d3-52de3b81be35","3a5a43c0-a9cf-42cc-a011-b022dd00a6bf","fb773994-b10e-49e6-ad9b-24a05f967f1d"],"names":["Girafe Florale","Zombie Floral","Catimimi","Yotaru Gardefeuille"]},{"key":"122-174-195-211","src":"tier121#42","nums":[122,174,195,211],"ids":["d2e2e893-6688-4a1a-9d92-1d239e8d0a75","a0ce442e-65ac-4e50-86d3-52de3b81be35","87ed2393-4bad-4243-ae7f-4c9c0681717d","503c6c18-e7d4-4f41-bdbb-24225bc245a6"],"names":["Esprit de la Faune","Zombie Floral","Gabriel","Dragosaure Céleste"]},{"key":"36-96-188-227","src":"tier121#32","nums":[36,96,188,227],"ids":["8d69f6e4-0e59-4522-8fe0-b75474140597","a1466fba-ebbf-4017-b3ad-771b2df09a15","3c38bd35-20d2-4369-971c-9216d21da76a","4dc96cb5-d342-4ef6-8808-fcc79c63690b"],"names":["Astry","Mélodie des Divinités","Commando Gerz","Chouette Polychrome"]},{"key":"136-142-231-263","src":"F_meta.topDecks.P1_N#1","nums":[136,142,231,263],"ids":["1d3d896d-c640-4d88-a1af-059f39546c60","cd9beb57-00f1-412e-9c75-981ffdd56a38","40416045-b820-4d2c-96f9-34f87d99ac25","d27faf84-0a03-4c16-b744-c555cd6f1edc"],"names":["Souverain des Chutes d'Éther","Squall, Émissaire des cauchemars","Aleera Mange-Cauchemars","Paguroniyx"]}];
const IDS={"tisseuse":"75491473-57fa-4b8f-aced-9d61d0404e65","fleur":"9a5c316d-6a42-4353-8f1a-5c3dc7703538"};
const M=MODELS.x1; const byId=new Map(M.cards.map(c=>[c.id,c]));
const CARD=id=>{const c=byId.get(id); if(!c) throw new Error('unknown card '+id); return c;};
const ent=ids=>ids.map(id=>({card:CARD(id),talent:null}));
const rec=M.recommended||{};
const MATCH=J, SCORE=Y;
if(typeof MATCH!=='function'||typeof SCORE!=='function'||typeof le!=='function'||typeof T!=='function'||typeof xe!=='function'||!Array.isArray(d)||!o.opponent) throw new Error('1.21 name mapping failed');
const LE0=le; let HOOK=null;
le=function(st,t){ if(HOOK) HOOK(st,t); return LE0(st,t); };
const ZERO={id:'zero',cardHp:700,resist:0};
const BASEDPS=o.opponent.dpsByTurn.slice();
const setDps=f=>{for(let i=0;i<BASEDPS.length;i++)o.opponent.dpsByTurn[i]=BASEDPS[i]*f;};
const V=t=>o.opponent.dpsByTurn[Math.min(t,o.opponent.dpsByTurn.length)-1];
const all=v=>({fire:v,water:v,earth:v,nature:v,shadow:v,light:v});

// ---- outcome of a 30-turn race: W = our kill of the 4 enemies first, L = our 4 cards dead first, T = neither
function race(r){
  const alive=new Map(r.events.filter(e=>e.type==='ownDeath'||e.type==='ownRevive').map(e=>[e.card,true]));
  let wipe=null; const dead=new Set();
  for(const e of r.events){
    if(e.type==='ownDeath'){dead.add(e.card);} else if(e.type==='ownRevive'){dead.delete(e.card);}
    if(e.type==='ownDeath'&&dead.size>=4&&wipe==null) wipe=e.turn;
  }
  const kill=r.kills>=4&&r.ttk!=null?Math.ceil(r.ttk-1e-9):null;
  const out=kill!=null&&(wipe==null||kill<=wipe)?'W':(wipe!=null?'L':'T');
  return {o:out,kill,wipe};
}
// ---- per-card opponent from a real deck: unopposed per-card curves (potential mode vs a 0-resistance target)
const OPPCACHE=new Map();
function oppFromDeck(ids,player,turns,talents){
  const key=ids.join(',')+'|'+player+'|'+turns+'|'+talents;
  if(OPPCACHE.has(key)) return OPPCACHE.get(key);
  const cards=ids.map(CARD);
  const r=MATCH(cards.map(c=>({card:c,talent:talents?(rec[c.id]??null):null})),{potential:true,player,turns,opponent:ZERO});
  const P=r.potential; const n=cards.length; const heal=P.healByTurn.map(v=>v/n);
  const opp={id:'deck',cards:cards.map((c,i)=>{
    const prof=T([{card:c}]); const tot=Object.values(prof).reduce((a,b)=>a+b,0);
    const mix=tot>0?Object.fromEntries(Object.entries(prof).map(([k,v])=>[k,v/tot])):null;
    const dsum=P.dmgByCard[i].reduce((a,b)=>a+b,0);
    return {id:'o'+i,name:c.name,hp:P.board[i].hp,res:P.board[i].res,phoenix:P.board[i].phoenix,brut:P.board[i].brut,
      dmgByTurn:P.dmgByCard[i],healByTurn:heal,mix,aoe:dsum>0?Math.min(1,P.aoeByCard[i]/dsum):0};
  })};
  opp.dmg10=Math.round(P.dmgByCard.reduce((a,row)=>a+row.slice(0,10).reduce((x,y)=>x+y,0),0));
  OPPCACHE.set(key,opp); return opp;
}
function score18(ids,opts={}){let s=0,n=0;for(const prof of d)for(const p of [1,2]){s+=SCORE(MATCH(ent(ids),{opponent:prof,player:p,...opts}));n++;}return s/n;}
function race18(ids){let w=0,l=0,t=0;for(const prof of d)for(const p of [1,2]){const x=race(MATCH(ent(ids),{opponent:prof,player:p,turns:30}));x.o==='W'?w++:x.o==='L'?l++:t++;}return {w,l,t};}
// ---- incident opponent (per-card): Tisseuse (no damage, absorbs), Fleur de Vie (10/turn, permanent taunt), 2 x 700 HP carrying the curve
function azurian(turns){
  const Tis=CARD(IDS.tisseuse), Fl=CARD(IDS.fleur);
  const arr=f=>Array.from({length:turns},(_,i)=>f(V(i+1)));
  return {id:'azurian',cards:[
    {id:'tisseuse',hp:Tis.hp,res:{...Tis.res},dmgByTurn:arr(()=>0),aoe:0},
    {id:'fleur',hp:Fl.hp,res:{...Fl.res},dmgByTurn:arr(()=>10),aoe:0},
    {id:'x1',hp:700,res:all(10),dmgByTurn:arr(v=>(v-10)/2),aoe:o.opponent.aoeShare},
    {id:'x2',hp:700,res:all(10),dmgByTurn:arr(v=>(v-10)/2),aoe:o.opponent.aoeShare}]};
}
// absorb (Veuve noire, CD 8): ready at turn 7 if the opponent plays second (we are P1), turn 8 if it plays first (we are P2)
function absorbHook(targetId){
  return (st,t)=>{ const T0=st.player===1?7:8; if(t!==T0||st._abs) return; st._abs=1;
    const tis=st.enemies.find(e=>e.id==='tisseuse'&&e.hp>0); if(!tis) return;
    const X=st.cards.find(c=>c.card.id===targetId&&!c.dead); if(!X) return;
    const hp=X.hpMax; X.dead=true; X.dmgTaken=X.hpMax;
    // the card leaves the board: stop its per-turn passives too (engine would keep them, see B_engine.md C11)
    X.coeur=[]; X.mimetism=false; X.incisive=0; X.critPerTurn=0; X.resOnHit=0; X.corrosion=0; X.focus=0; X.hpGrowth=0; X.regenPct=0; X.luckPerTurn=0; X.cimetiere=0;
    X.passives=X.passives.filter(p=>p.type!=='punchingBag');
    tis.hp+=hp; tis.hpMax+=hp; st.events.push({turn:t,type:'absorbed',card:X.card.name}); };
}
function incidentRun(ids,{taunt,absorbId}){
  const rows=[];
  for(const p of [1,2]){
    HOOK=absorbId?absorbHook(absorbId):null;
    const r10=MATCH(ent(ids),{opponent:azurian(10),player:p,...(taunt?{focus:'fleur'}:{})});
    HOOK=absorbId?absorbHook(absorbId):null;
    const r30=MATCH(ent(ids),{opponent:azurian(30),player:p,turns:30,...(taunt?{focus:'fleur'}:{})});
    HOOK=null;
    rows.push({p,J:Math.round(SCORE(r10)),...race(r30),absorbed:r10.events.some(e=>e.type==='absorbed')});
  }
  return {J:Math.round((rows[0].J+rows[1].J)/2),wins:rows.filter(x=>x.o==='W').length,byOrder:rows};
}

const out={mode:MODE};
if(MODE==='check'){
  const pickD=['chimere','robA','anticrit','zerocrit','dc1'];
  out.check={};
  for(const lab of pickD){
    const D=OUR.find(x=>x.label===lab);
    const I=ht(M); const ev=I.evaluate(D.ids.map(id=>({id,talentId:null})),{optimize:false,suggestions:false,shop:false}).score;
    const mine=score18(D.ids);
    HOOK=(st,t)=>{}; const hooked=score18(D.ids); HOOK=null;
    let nA=0,nC=0; for(const p of [1,2]){nA+=SCORE(MATCH(ent(D.ids),{opponent:d[0],player:p}));
      nC+=SCORE(MATCH(ent(D.ids),{opponent:{id:'clone',cards:[0,1,2,3].map(i=>({id:'n'+i,hp:700,res:all(10),dmgByTurn:BASEDPS.map(v=>v/4),aoe:o.opponent.aoeShare}))},player:p}));}
    setDps(1.5); const x15=score18(D.ids); setDps(2); const x2=score18(D.ids); setDps(1);
    out.check[lab]={evaluate:ev,mine18:mine,withNoopHook:hooked,neutralAbstract:nA/2,neutralPerCardClone:nC/2,x15,x2};
  }
  out.oppDmg10={};
  for(const m of META){out.oppDmg10[m.key]={none:oppFromDeck(m.ids,2,10,false).dmg10,rec:oppFromDeck(m.ids,2,10,true).dmg10};}
  out.abstractDmg10=BASEDPS.reduce((a,b)=>a+b,0);
}
if(MODE.startsWith('duel:')){
  const tal=MODE==='duel:rec';
  out.duel={};
  for(const D of OUR){
    const R={label:D.label,nums:D.nums,vs:{}};
    let wins=0,losses=0,timeouts=0,Jsum=0,n=0;
    for(const m of META){
      const per=[];
      for(const p of [1,2]){
        const opp10=oppFromDeck(m.ids,3-p,10,tal), opp30=oppFromDeck(m.ids,3-p,30,tal);
        const r10=MATCH(ent(D.ids),{opponent:opp10,player:p});
        const r30=MATCH(ent(D.ids),{opponent:opp30,player:p,turns:30});
        const rc=race(r30);
        per.push({p,J:Math.round(SCORE(r10)),o:rc.o,kill:rc.kill,wipe:rc.wipe,deaths10:r10.ownDeaths,kills10:r10.kills});
        Jsum+=SCORE(r10); n++; rc.o==='W'?wins++:rc.o==='L'?losses++:timeouts++;
      }
      R.vs[m.key]=per;
    }
    Object.assign(R,{wins,losses,timeouts,games:n,meanJ10:Math.round(Jsum/n)});
    out.duel[D.key]=R;
  }
  out.oppDmg10=Object.fromEntries(META.map(m=>[m.key,oppFromDeck(m.ids,2,10,tal).dmg10]));
}
if(MODE==='incident'){
  out.incident={};
  for(const D of OUR.filter(x=>x.named)){
    const R={label:D.label,nums:D.nums};
    R.plain=incidentRun(D.ids,{taunt:false});
    R.tauntOnly=incidentRun(D.ids,{taunt:true});
    const absBy={}, bothBy={};
    for(const id of D.ids){absBy[CARD(id).name]=incidentRun(D.ids,{taunt:false,absorbId:id}); bothBy[CARD(id).name]=incidentRun(D.ids,{taunt:true,absorbId:id});}
    const worst=o=>Object.entries(o).reduce((a,[k,v])=>(!a||v.J<a.v.J)?{k,v}:a,null);
    const wa=worst(absBy), wb=worst(bothBy);
    R.absorbOnly={target:wa.k,...wa.v,perTarget:Object.fromEntries(Object.entries(absBy).map(([k,v])=>[k,{J:v.J,wins:v.wins}]))};
    R.tauntAbsorb={target:wb.k,...wb.v,perTarget:Object.fromEntries(Object.entries(bothBy).map(([k,v])=>[k,{J:v.J,wins:v.wins}]))};
    out.incident[D.key]=R;
  }
}
if(MODE==='sens'){
  out.sens={};
  for(const D of OUR.filter(x=>x.named)){
    const R={label:D.label,nums:D.nums};
    for(const f of [1,1.5,2]){ setDps(f); R['x'+f]={J:Math.round(score18(D.ids)),race:race18(D.ids)}; }
    setDps(1);
    out.sens[D.key]=R;
  }
}
le=LE0; HOOK=null; setDps(1);
OUT.res=out;
})();
