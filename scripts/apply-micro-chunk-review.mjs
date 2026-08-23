import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

// 869문장 초안 전수 열람 뒤 직접 교정한 첫 노출용 의미 발판이다.
// 첫 단계에서는 구조가 보이게 작게 나누고, 다음 단계의 assemblyChunks에서
// 원어민 표현 단위가 다시 합쳐지도록 한다.
const manualCorrections = {
  'cv-0003': [['I have', 'some friends', 'living in Chicago.'], ['내게는 있어요', '친구가 몇 명', '시카고에 사는.']],
  'cv-0021': [['You should have', 'something', 'before you leave.'], ['뭐라도 먹는 게 좋아요', '조금은', '떠나기 전에.']],
  'cv-0024': [['Just a banana.', 'I', 'was in a rush.'], ['그냥 바나나 하나요.', '나는', '무척 바빴거든요.']],
  'cv-0044': [['Want to talk', 'about it?'], ['이야기할래', '그 일에 관해?']],
  'cv-0057': [['Oh,', 'Costco is having', 'a sale', 'on Samsonite luggage', 'right now.'], ['아,', '코스트코가 진행 중이에요', '할인 행사를', '샘소나이트 여행 가방에', '바로 지금.']],
  'cv-0058': [['How is life', 'in Brazil', 'treating you,', 'Junho?'], ['생활은', '브라질에서', '어떠니,', '준호?']],
  'cv-0061': [['Yeah,', 'a couple of Korean families', 'live', 'in my apartment building', 'and we have', 'barbeques', 'every Friday.'], ['네,', '한국인 가족 두어 가정이', '살고 있어요', '우리 아파트에', '그리고 함께 해요', '바비큐 파티를', '매주 금요일마다.']],
  'cv-0068': [["I forgot my wallet.", 'Could you', 'throw it down', 'to me, please?'], ['지갑을 두고 왔어.', '해 줄래', '그걸 아래로 던지는 걸', '나한테?']],
  'cv-0073': [['I have', 'some errands', 'to run', 'this afternoon.'], ['내게 있어요', '볼일이 몇 가지', '처리해야 할', '오늘 오후에.']],
  'cv-0077': [['Yes,', 'sorry', "I'm late.", 'I had', 'something to take care of.'], ['네,', '미안해요', '늦어서요.', '일이 있었어요', '처리해야 할.']],
  'cv-0081': [['I just sold', 'five pairs of pants', 'on Joonggonara,', 'so I have', 'a lot of packages', 'to ship.'], ['방금 팔았어요', '바지 다섯 벌을', '중고나라에서,', '그래서 내게 있어요', '소포가 아주 많이', '보내야 할.']],
  'cv-0090': [['These pants', 'don’t have', 'pockets.'], ['이 바지에는', '달려 있지 않아요', '주머니가.']],
  'cv-0102': [['Red ginseng', 'has', 'a lot of health benefits.'], ['홍삼에는', '있어요', '건강에 좋은 점이 아주 많아요.']],
  'cv-0104': [['The first place', 'is near the river,', 'but', 'there’s no parking…'], ['첫 번째 집은', '강 가까이에 있고,', '하지만', '주차할 곳이 없어요…']],
  'cv-0111': [['Do you have', 'any cash', 'on you?'], ['있나요', '현금이 좀', '수중에?']],
  'cv-0121': [['I need', 'a few minutes', 'to finish this.'], ['시간이 필요해요', '몇 분', '이걸 끝내려면.']],
  'cv-0126': [["I’ll have", 'my husband', 'meet you', 'near the station.'], ['제가 부탁할게요', '제 남편에게', '당신을 만나라고', '역 근처에서.']],
  'cv-0127': [['Maybe you could have Jeff', 'give you', 'some exercise tips.'], ['제프에게 부탁해 봐도 되겠네요', '당신에게 알려 달라고', '운동 요령을 좀.']],
  'cv-0128': [['I will have', 'my secretary', 'get back to you.'], ['제가 부탁하겠습니다', '제 비서에게', '다시 연락드리라고.']],
  'cv-0135': [['She', 'is currently with', 'a client', 'right now.', 'May I take', 'a message?'], ['그분은', '지금 함께 계세요', '의뢰인과', '현재는요.', '제가 받아 둘까요', '메시지를?']],
  'cv-0136': [['Yes,', 'I’m a client of hers—', 'Kevin Lee.', 'Could you have her', 'call me back,', 'please?'], ['네,', '그분의 의뢰인이고,', '케빈 리예요.', '그분께 부탁해 주실래요', '제게 다시 전화해 달라고,', '부탁드려요?']],
  'cv-0142': [['My boyfriend', 'got a ticket', 'to the concert.'], ['내 남자 친구가', '표를 구했어요', '그 콘서트에 갈.']],
  'cv-0146': [['Where did you get', 'this leather jacket?'], ['어디서 구했어요', '이 가죽 재킷을?']],
  'cv-0147': [['Where can I get', 'a coffee', 'around here?'], ['어디서 살 수 있나요', '커피를', '이 근처에서?']],
  'cv-0148': [['How did you get', 'this designer bag?'], ['어떻게 구했어요', '이 명품 가방을?']],
  'cv-0157': [['This sandwich', 'has', 'more than double the calories', 'of a Big Mac.'], ['이 샌드위치는', '열량이', '두 배 넘게 많아요', '빅맥보다.']],
  'cv-0161': [['I’m hoping', 'to get', 'an internship', 'in San Francisco', 'this summer.'], ['바라고 있어요', '구하기를', '인턴 자리를', '샌프란시스코에서', '이번 여름에.']],
  'cv-0162': [['If I don’t get', 'a scholarship,', 'I won’t', 'be able to go', 'this semester.'], ['받지 못하면', '장학금을,', '저는 못할 거예요', '학교에 다니는 걸', '이번 학기에는.']],
  'cv-0180': [["Let’s go get", 'a drink.', 'I know', 'a great place.'], ['우리 나가서 마시자', '한잔을.', '내가 알아', '좋은 곳을.']],
  'cv-0198': [['Can we get', 'salad', 'instead of fries', 'with our dinner?'], ['저희가 받을 수 있을까요', '샐러드를', '감자튀김 대신', '저녁 식사와 함께요?']],
  'cv-0200': [['Sure,', 'we’ll leave them', 'in front of your door.'], ['물론이죠,', '수건을 놓아 드릴게요', '객실 문 앞에.']],
  'cv-0205': [['Can I get', 'the same thing', 'they’re having?'], ['저도 같은 걸로 받을 수 있을까요', '같은 메뉴를', '저분들이 드시는 것과?']],
  'cv-0206': [['Can I get', 'change', 'for this $20, please?'], ['바꿔 주실래요', '잔돈으로', '이 20달러를요?']],
  'cv-0210': [['When', 'did you get here?'], ['언제', '여기에 도착했어?']],
  'cv-0217': [['Well,', 'I’d like', 'to get to', 'where you are.', 'Do you have', 'any advice?'], ['음,', '저도 그러고 싶어요', '도달하는 걸', '팀장님이 계신 자리까지.', '있나요', '해 주실 조언이?']],
  'cv-0218': [['To get to', 'where I am,', 'you’ll need to know', 'what other departments do.'], ['도달하려면', '내가 있는 자리까지,', '알아야 해요', '다른 부서가 무슨 일을 하는지.']],
  'cv-0231': [["It’s Sarah’s birthday.", 'I need to get', 'her', 'flowers.'], ['오늘은 사라의 생일이야.', '사 줘야 해', '사라에게', '꽃을.']],
  'cv-0233': [['Another bad', 'real estate policy?'], ['또 엉터리', '부동산 정책이야?']],
  'cv-0250': [["That’s good,", 'but you should', 'keep in mind', 'that it gets a bit noisy', 'at night', 'with all the bars nearby.'], ['그건 좋지만,', '그래도 꼭', '염두에 두세요', '조금 시끄러워진다는 걸', '밤에는', '근처에 술집이 많아서.']],
  'cv-0252': [['OK,', 'I have', 'some quieter places', 'to show you.'], ['좋아요,', '저한테 있어요', '좀 더 조용한 곳들이', '보여 드릴.']],
  'cv-0254': [["I don’t think", 'you should read', 'any more articles', 'from the Economist.', 'All it does is', 'make your English awkward.'], ['아닌 것 같아요', '당신이 더 읽어야 한다는 건', '더 이상의 기사들을', '이코노미스트에서 나온.', '그게 하는 일이라곤', '당신의 영어를 어색하게 만드는 것뿐이에요.']],
  'cv-0261': [['My mom', 'got cancer', 'when I was', 'in middle school.'], ['엄마가', '암에 걸리셨어', '내가 다니고 있을 때', '중학교에.']],
  'cv-0268': [['Oh, no.', 'Sorry to hear that.', 'Stay close', 'to the toilet.'], ['아, 이런.', '그렇다니 안됐네.', '멀리 가지 마', '화장실에서.']],
  'cv-0277': [['She’s quite drunk.', 'Could you make sure', 'to get her home', 'safely?'], ['그녀는 꽤 취했어요.', '꼭 부탁드려요', '그녀를 집에 데려다주세요', '안전하게?']],
  'cv-0282': [['I', 'somehow managed', 'to get the kids to school', 'on time.'], ['나는', '어찌어찌 해냈어', '아이들을 학교에 보내는 걸', '제시간에.']],
  'cv-0291': [['We get', 'a lot of tourists', 'in the summer.'], ['우리 지역에는 와요', '관광객이 많이', '여름에는.']],
  'cv-0294': [['Even on the weekend', 'we don’t get', 'much foot traffic', 'these days.'], ['주말에도', '우리 가게에는 없어요', '찾아오는 손님이 많이', '요즘에는.']],
  'cv-0295': [['My apartment', 'faces the ocean,', 'so we get', 'a fresh sea breeze', 'most days.'], ['우리 아파트는', '바다를 향해서,', '그래서 들어와요', '상쾌한 바닷바람이', '거의 매일.']],
  'cv-0301': [['Nope.', 'We don’t get', 'much foot traffic,', 'even on Saturdays', 'now.'], ['아니.', '우리 가게에는 없어요', '찾아오는 손님이 많이,', '토요일에도', '요즘은.']],
  'cv-0311': [['I got you', 'a tuna kimbap.', 'I hope', 'that’s OK.'], ['너 주려고 사 왔어', '참치김밥을.', '그러면 좋겠어', '괜찮기를.']],
  'cv-0313': [['You got us', 'tickets to the John Lee concert?', 'How?'], ['우리에게 구해 줬다고', '존 리 콘서트 표를?', '어떻게?']],
  'cv-0318': [['They were fully booked,', 'but the server', 'managed to get us', 'a booth', 'with a view', 'of the river.'], ['예약이 다 찼는데,', '그래도 직원이', '우리에게 마련해 줬어', '부스석을', '전망이 있는', '강이 보이는.']],
  'cv-0327': [['I need to get', 'my windshield replaced', 'on my car.'], ['교체해야 해', '앞유리를', '내 차에 달린.']],
  'cv-0331': [['I got', 'my taxes done', 'by an accountant.'], ['처리했어', '세금 신고를', '회계사에게 맡겨서.']],
  'cv-0338': [['That sounds like', 'a better plan', 'to me.'], ['더 나은 계획 같아요', '그게', '제게는.']],
  'cv-0340': [['That sounds like', 'a perfect place', 'for you.'], ['딱 맞는 곳 같아요', '그곳이', '당신에게.']],
  'cv-0348': [['How am I going to', 'finish', 'all this work?'], ['나는 어떻게 해야 하지', '끝내려면', '이 많은 일을?']],
  'cv-0352': [['I know,', 'but I don’t want', 'to make a big deal', 'out of it.'], ['알아요,', '하지만 원하지 않아요', '크게 문제 삼는 걸', '이 일을.']],
  'cv-0357': [['Did you know', 'Sarah is', 'a real estate agent', 'now?'], ['알고 있었어', '사라가', '부동산 중개인이라는 걸', '이제는?']],
  'cv-0366': [['Oh,', 'that’s nice.', 'My sister made me', 'a personalized mug', 'one time.'], ['오,', '멋지다.', '내 여동생도 내게 만들어 줬어', '맞춤형 머그잔을', '예전에 한 번.']],
  'cv-0372': [['I don’t cook much', 'because', 'it’s cheaper', 'to go out and eat', 'than to cook', 'for one person.'], ['나는 요리를 많이 하지 않아요', '왜냐하면', '더 싸기 때문이에요', '나가서 사 먹는 게', '요리하는 것보다', '혼자 먹으려고.']],
  'cv-0376': [['The pandemic', 'made', 'online learning', 'the new norm.'], ['팬데믹이', '만들었어요', '온라인 학습을', '새로운 표준으로.']],
  'cv-0386': [['Yeah,', 'especially', "if you're on your phone", 'all day.'], ['응,', '특히', '휴대폰을 보고 있다면', '하루 종일.']],
  'cv-0406': [['I got', 'the airline', 'to upgrade my seat', 'to first class.'], ['나는 부탁했어요', '항공사에', '내 좌석을 업그레이드해 달라고', '일등석으로.']],
  'cv-0407': [['I got', 'Sarah', 'to fill in for me', 'at work', 'so I could take', 'the day off.'], ['나는 부탁했어요', '사라에게', '나를 대신해 달라고', '직장에서', '그래서 낼 수 있게', '하루 휴가를.']],
  'cv-0412': [['You’re making me', 'feel terrible.'], ['너 때문에 내가', '기분이 너무 안 좋아.']],
  'cv-0417': [['Not really.', 'Venting', 'didn’t make me feel', 'any better.'], ['별로 그렇지 않았어요.', '화를 쏟아 내도', '기분이 나아지진 않았어요', '조금도.']],
  'cv-0424': [['That sounds fun.', 'Do you know', 'what’s playing?'], ['그거 재미있겠다.', '알아', '무엇을 상영 중인지?']],
  'cv-0426': [['I’m not much of a movie-goer.', 'I usually', 'just stick to', 'YouTube.'], ['영화관을 즐겨 찾는 편은 아니에요.', '나는 보통', '그냥 봐요', '유튜브만.']],
  'cv-0428': [['Hey, guys.', 'I don’t think', 'I can make it', 'to lunch.'], ['얘들아.', '아무래도', '못 갈 것 같아', '점심 자리에.']],
  'cv-0429': [['We’re having a party', 'tomorrow;', 'do you think', 'you can make it?'], ['파티를 열 거야', '내일;', '어떻게 생각해', '너도 올 수 있을까?']],
  'cv-0430': [['I barely made it', 'to the airport', 'on time,', 'only to have', 'my flight delayed.'], ['가까스로 도착했어요', '공항에', '제시간에,', '그런데 결국', '항공편이 지연됐죠.']],
  'cv-0434': [['Do you think', 'we can make it there', 'in time?'], ['그럴 것 같아', '우리가 거기 도착할 수 있을까', '제시간에?']],
  'cv-0437': [['Pretty good!', 'Do you think', 'you can make it', 'this weekend?'], ['꽤 좋아!', '그럴 것 같아', '네가 올 수 있을까', '이번 주말에?']],
  'cv-0435': [['How’s it going,', 'Mina?'], ['어떻게 지내,', '미나야?']],
  'cv-0442': [['I was thinking', 'of quitting', 'every week.', 'I’m so glad', 'I kept studying,', 'and that I made it', 'to the end', 'of the semester.'], ['생각했어요', '포기할까 하고', '매주.', '정말 다행이에요', '공부를 계속했고,', '그리고 버텼다는 것도', '끝까지', '학기가 끝날 때까지.']],
  'cv-0445': [['Of course,', 'you will make', 'a good teacher.'], ['당연히,', '당신은 될 거예요', '좋은 선생님이.']],
  'cv-0446': [['He', 'would make', 'a great actor.'], ['그는', '될 거예요', '훌륭한 배우가.']],
  'cv-0447': [['You’ll make', 'a great coach.'], ['당신은 될 거예요', '훌륭한 코치가.']],
  'cv-0449': [['My grandma always', 'used to tell me', 'to learn to cook.', 'Otherwise,', 'I wouldn’t make', 'a good wife.'], ['우리 할머니는 늘', '내게 말씀하곤 하셨어요', '요리를 배우라고.', '그러지 않으면,', '나는 되지 못할 거라고', '좋은 아내가.']],
  'cv-0450': [['I can’t put', 'this book down.', 'It would', 'make a great movie.'], ['도저히 손에서 못 놓겠어', '이 책을.', '그건 충분히', '멋진 영화가 될 거야.']],
  'cv-0466': [['Sure!', 'Take', 'as many as you want.'], ['물론이지!', '가져가', '원하는 만큼.']],
  'cv-0476': [['I’ll take', 'the chicken salad.'], ['저는 주문할게요', '치킨 샐러드를.']],
  'cv-0487': [['My team and I', 'are working on', 'a proposal', 'that we will present', 'very soon.'], ['저와 저희 팀은', '준비하고 있어요', '계획안을', '우리가 발표할', '곧.']],
  'cv-0492': [['Sorry,', 'we don’t accept walk-ins.', 'You’ll need to make', 'an appointment.'], ['죄송해요,', '비예약 방문은 받지 않아요.', '미리 하셔야 해요', '예약을.']],
  'cv-0493': [['The doctor only sees', 'walk-ins', 'between 9 and 11 a.m.'], ['의사는 이때만 진료합니다', '비예약 환자를', '오전 9시부터 11시 사이에.']],
  'cv-0501': [['I didn’t think', 'my boss', 'would actually take', 'my advice,', 'but he did!'], ['생각지 못했어', '상사가', '정말 받아들일 줄은', '내 조언을,', '그런데 정말 받아들였어!']],
  'cv-0502': [['I’m sorry', 'I have to quit', 'so suddenly,', 'but I need', 'to take this opportunity.'], ['미안해요', '그만둬야 해서', '이렇게 갑자기,', '하지만 꼭 해야 해요', '이 기회를 잡는 걸.']],
  'cv-0503': [['If I don’t take', 'a chance', 'now,', 'it might be too late.'], ['내가 잡지 않으면', '기회를', '지금,', '너무 늦을지도 몰라요.']],
  'cv-0510': [['My brother', 'can’t make ends meet,', 'so', 'I’m going to lend him', 'some money.'], ['내 동생은', '생활비를 감당하지 못해서,', '그래서', '내가 빌려주려고 해', '돈을 좀.']],
  'cv-0513': [['I have', 'a lot of bills', 'to pay', 'every month.', 'It’s impossible', 'to save.'], ['내게 있어요', '고지서가 아주 많아요', '내야 할', '매달.', '불가능해요', '저축하기는.']],
  'cv-0529': [['My cousin spent', 'a great deal of time', 'in Chile,', 'so she speaks Spanish.'], ['내 사촌은 지냈어', '아주 오랜 시간을', '칠레에서,', '그래서 스페인어를 해.']],
  'cv-0531': [['Yeah, actually.', 'My cousin is a developer', 'with a great deal of', 'knowledge and experience.'], ['응, 사실은.', '내 사촌이 개발자야', '아주 풍부한', '지식과 경험을 갖춘.']],
  'cv-0543': [['I can’t believe', 'it took them', 'this long.'], ['믿을 수가 없어', '그들에게 걸렸다는 게', '이렇게 오래.']],
  'cv-0544': [['Some say', 'painting is', 'a relaxing hobby.'], ['어떤 사람들은 말해', '그림 그리기가', '마음이 편해지는 취미라고.']],
  'cv-0550': [['Watching you walk around', 'the house', 'all day', 'stresses me out.'], ['네가 돌아다니는 걸 보면', '집 안을', '하루 종일', '정말 스트레스받아.']],
  'cv-0555': [['Depression', 'cannot be taken', 'lightly.'], ['우울증은', '여겨져서는 안 돼요', '가볍게.']],
  'cv-0558': [['Internet trolls.', 'He', 'takes', 'YouTube comments', 'so personally.'], ['악플러들 때문이지.', '그는', '받아들이는 거야', '유튜브 댓글을', '너무 개인적인 공격으로.']],
  'cv-0561': [['You have', 'kids, right?', 'They probably', 'had to change schools.'], ['당신에게는 있어요', '아이들이, 그렇죠?', '아이들은 아마도', '학교를 옮겨야 했겠네요.']],
  'cv-0566': [['How did you like', 'London?'], ['어땠어', '런던은?']],
  'cv-0567': [['How do you like', 'retirement,', 'Jack?'], ['어때', '은퇴 생활은,', '잭?']],
  'cv-0575': [['Are you free', 'this afternoon?'], ['시간 돼', '오늘 오후에?']],
  'cv-0576': [['I’m afraid not.', 'I have', 'a hair appointment,', 'then', 'I’m going', 'to get my nails done.'], ['안 될 것 같아.', '예약이 있어', '미용실에,', '그리고', '갈 거야', '네일을 받으러.']],
  'cv-0582': [['Online banking', 'saves us', 'a trip', 'to the bank.'], ['온라인 뱅킹은', '우리에게 덜어 줘요', '한 번 갈 일을', '은행에.']],
  'cv-0584': [['He offered me', 'a ride', 'home.'], ['그가 태워 주겠다고 했어', '나를', '집까지.']],
  'cv-0588': [['My cat likes', 'to knock things off', 'the table.'], ['우리 고양이는 좋아해', '물건을 쳐서 떨어뜨리는 걸', '테이블에서.']],
  'cv-0589': [['I like to study,', 'but I’m not', 'cut out for', 'the medical field.'], ['나는 공부하는 걸 좋아하지만,', '하지만 나는 아니에요', '잘 맞는 사람이', '의료 분야에.']],
  'cv-0600': [['I hate', 'when they put corn', 'on cheese pizza', 'without any warning', 'on the menu.'], ['정말 싫어요', '옥수수를 올리는 게', '치즈 피자에', '아무런 안내도 없이', '메뉴에.']],
  'cv-0610': [['Oh,', 'I think I see', 'our car.', 'Next to the red one.', 'Do you see it?'], ['아,', '보이는 것 같아', '우리 차가.', '빨간 차 바로 옆에.', '너도 보여?']],
  'cv-0621': [['I know', 'a good place', 'not far from here.'], ['아는 곳이 있어요', '괜찮은 곳을', '여기서 멀지 않은.']],
  'cv-0631': [['It seems like', 'your style.', 'It would suit', 'you.'], ['그런 느낌이야', '네 스타일이라는.', '잘 어울릴 거야', '너한테.']],
  'cv-0633': [['Did you see', 'that girl', 'riding the bike?', 'I think', 'I know her.'], ['봤어', '저 여자애를', '자전거를 타고 가는?', '아무래도', '내가 아는 사람 같아.']],
  'cv-0636': [['Do you smell', 'something burning?'], ['냄새 나니', '뭔가 타는?']],
  'cv-0637': [['Wait,', 'I smell something', 'cooking.', 'Smells great.'], ['잠깐,', '냄새가 나', '뭔가 요리되는.', '냄새 좋다.']],
  'cv-0643': [['Acupuncture', 'really works', 'for me.', 'Why don’t you', 'give it a shot?'], ['침은', '정말 효과가 있어', '나에게.', '한번 해 보지 그래', '침 치료도?']],
  'cv-0649': [['Don’t we have', 'a wedding to go to', 'at 4?'], ['우리 있지 않아', '가야 할 결혼식이', '4시에?']],
  'cv-0653': [['Maybe not today,', 'but', 'if you trained for it,', 'you could.', 'Give it a shot!'], ['오늘 당장은 아닐지라도,', '하지만', '그에 맞춰 훈련한다면,', '할 수 있을 거야.', '도전해 봐!']],
  'cv-0662': [['Sorry,', 'but the app', 'doesn’t work', 'that way.'], ['죄송하지만,', '그 앱은', '쓰는 게 아니에요', '그런 방식으로.']],
  'cv-0664': [['Yeah,', 'transportation cards', 'don’t work', 'that way.'], ['응,', '교통 카드는', '쓸 수 없어', '그런 방식으로.']],
  'cv-0668': [['We’re happy', 'to hear that.', 'Of course,', 'you’ll need to make', 'a 3 million won deposit', 'today.'], ['기쁩니다', '그 말을 들으니.', '물론,', '내셔야 해요', '300만 원 계약금을', '오늘.']],
  'cv-0669': [['Not a problem.', 'If something comes up, though,', 'is it possible', 'for me to get', 'my deposit back?'], ['괜찮습니다.', '그런데 무슨 일이 생기면,', '가능할까요', '제가 돌려받는 게', '계약금을?']],
  'cv-0673': [['Thanks', 'for picking me up!'], ['고마워', '데리러 와 줘서!']],
  'cv-0674': [['Not a problem.', 'I was on my way', 'anyway.'], ['괜찮아.', '나도 가는 길이었어', '어차피.']],
  'cv-0677': [['No,', 'they were', 'a gift.'], ['아니요,', '그 바지는', '선물이었어요.']],
  'cv-0681': [['I hope', 'the meeting', 'goes well', 'tomorrow.'], ['바라요', '회의가', '잘 진행되기를', '내일.']],
  'cv-0686': [['It was the third date,', 'and it went OK,', 'but there’s still something', 'about her', 'that I’m not sure about.'], ['세 번째 데이트였고,', '그럭저럭 괜찮았어,', '하지만 아직 뭔가 있어', '그녀에게', '내가 확신이 안 서는 부분이.']],
  'cv-0691': [['There is', 'something', 'about old pop songs', 'that I find', 'so comforting.'], ['뭔가 있어요', '어떤 점이', '옛날 팝송에는', '내가 느끼기에', '아주 편안한.']],
  'cv-0695': [['Laptops', 'aren’t really', 'for me.', 'Something about', 'the keyboards', 'is super uncomfortable.'], ['노트북은', '별로 맞지 않아', '나한테.', '뭔가가', '그 키보드에', '너무 불편해.']],
  'cv-0699': [['My phone', 'went dead.', 'Do you have', 'a charger?'], ['내 휴대폰이', '배터리가 나갔어.', '혹시 있어', '충전기?']],
  'cv-0702': [['Are we', 'out of milk?'], ['우리 집은', '우유가 다 떨어졌어?']],
  'cv-0704': [['What', 'are those people doing?', 'It looks', 'dangerous.'], ['뭘', '저 사람들은 하고 있어?', '저건 보여', '위험하게.']],
  'cv-0711': [['That’s so true.', 'It’s really dark,', 'too.'], ['정말 맞아.', '아주 어둡기도 해,', '게다가.']],
  'cv-0715': [['Should these flowers', 'go here?'], ['이 꽃들은', '여기에 두면 될까요?']],
  'cv-0720': [['Do these dumbbells', 'go here?'], ['이 덤벨들은', '여기에 두나요?']],
  'cv-0737': [['I want', 'that robotic vacuum.'], ['사고 싶어', '저 로봇 청소기를.']],
  'cv-0740': [['I signed up', 'for a Pilates class', 'at the gym.'], ['신청했어', '필라테스 수업을', '헬스장에서.']],
  'cv-0741': [['Really?', 'I have been wanting', 'to try', 'the new instructor’s class.'], ['정말요?', '계속 해 보고 싶었어요', '한번 들어 보는 걸', '새 강사의 수업을.']],
  'cv-0745': [['I’ve been wanting', 'to try', 'that new cafe', 'next to the palace.'], ['계속 가 보고 싶었어', '한번', '저 새 카페에', '궁 옆에 있는.']],
  'cv-0763': [['Sure,', 'that shouldn’t be', 'a problem.'], ['물론이죠,', '그건 아닐 거예요', '문제가.']],
  'cv-0766': [['Let me', 'walk you out.'], ['제가', '문까지 바래다드릴게요.']],
  'cv-0768': [['Let me', 'go with you.'], ['내가', '같이 갈게.']],
  'cv-0769': [['Let me', 'take a look.'], ['제가', '한번 볼게요.']],
  'cv-0771': [['Let me', 'pour you', 'another glass of wine.'], ['제가', '따라 드릴게요', '와인 한 잔 더.']],
  'cv-0778': [['I need to', 'head home.'], ['이제 가야 해', '집으로.']],
  'cv-0779': [['It’s time to', 'head home.'], ['갈 시간이야', '집으로.']],
  'cv-0781': [['My wife', 'is calling.', 'I better', 'get going.'], ['내 아내가', '전화하고 있어.', '나는 이제', '가야겠다.']],
  'cv-0783': [['Could you', 'let me finish', 'my sentence, please?'], ['부탁드려요', '끝내게 해 주세요', '지금 하던 말을?']],
  'cv-0789': [['Did your parents have', 'any weird rules', 'growing up?'], ['부모님에게도 있었어', '이상한 규칙이', '네가 자랄 때?']],
  'cv-0792': [['I know!', 'I thought', 'they were going to', 'kick us out,', 'though.'], ['그러게!', '나는 생각했어', '그들이 곧', '우리를 쫓아낼 줄,', '그런데 말이야.']],
  'cv-0794': [['That’s because', 'we kept spending money there.', 'He should thank us!'], ['그건 그 때문이야', '우리가 거기서 계속 돈을 썼기.', '그가 우리에게 고마워해야 해!']],
  'cv-0800': [['I can’t let', 'nasty comments', 'discourage me.'], ['나는 허용하지 않아', '악성 댓글이', '나를 기죽이게.']],
  'cv-0801': [['Don’t let', 'work', 'get to you.', 'Let’s find', 'a new hobby.'], ['그냥 두지 마', '일이', '너를 힘들게 하도록.', '우리 찾아보자', '새로운 취미를.']],
  'cv-0802': [['We can’t let', 'another wildfire', 'like that', 'happen again.'], ['그냥 둘 수 없어요', '또 다른 산불이', '그런', '다시 일어나도록.']],
  'cv-0806': [['Andrew,', 'why aren’t you going on', 'more dates?'], ['앤드루,', '왜 나가지 않는 거야', '데이트를 더?']],
  'cv-0815': [['I applied to YouTube,', 'but I haven’t heard', 'anything back,', 'yet.'], ['유튜브에 지원했지만,', '아무 연락도 못 받았어요', '답을,', '아직.']],
  'cv-0818': [['This song', 'gives me chills.'], ['이 노래를 들으면', '소름이 돋아요.']],
  'cv-0823': [['Rainy days', 'always give me', 'the blues.'], ['비 오는 날은', '늘 나를 빠뜨려요', '우울한 기분에.']],
  'cv-0825': [['Oh, perfect!', 'That will give me', 'enough time', 'to grab some coffee.'], ['오, 딱 좋네요!', '그러면 생겨요', '내게 충분한 시간이', '커피를 좀 사 올 만큼.']],
  'cv-0827': [['You think so?', 'I don’t think', 'I’d get it.'], ['그렇게 생각해?', '아무래도', '붙기는 어려울 것 같아.']],
  'cv-0832': [['Guys,', 'I don’t think', 'I can make it', 'this week.'], ['얘들아,', '아무래도', '못 갈 것 같아', '이번 주에는.']],
  'cv-0842': [['OK,', 'give me a sec.', 'I’ll meet you down there.'], ['알았어,', '잠깐만 기다려 줘.', '내려가서 만날게.']],
  'cv-0851': [['Just to let you know,', 'Friday', 'will be my last day.'], ['미리 알려 두는데,', '금요일이', '내가 여기서 일하는 마지막 날이야.']],
  'cv-0856': [['Where do you keep', 'your spoons?'], ['어디에 두나요', '숟가락을?']],
  'cv-0857': [['I don’t keep', 'emails', 'that are', 'more than a year old.'], ['보관하지 않아요', '이메일을', '그런 것들은', '1년 넘게 지난.']],
  'cv-0859': [['No, no, that’s OK.', 'Just keep it', 'until I see you', 'next time.'], ['아니야, 아니야, 괜찮아.', '그냥 가지고 있어', '다시 만날 때까지', '다음에.']],
  'cv-0861': [['True.', 'I’ll have to get', 'my luggage out.'], ['맞아.', '꺼내야겠어', '내 여행 가방을.']],
  'cv-0868': [['I hope', 'the incoming president', 'can turn the economy around.'], ['바라요', '새로 오실 대통령이', '경제를 되살릴 수 있기를.']],
};

function joinChunks(chunks) {
  return chunks.reduce((sentence, chunk, index) => (
    index === 0 ? chunk : `${sentence}${/[—–]$/.test(sentence) ? '' : ' '}${chunk}`
  ), '');
}

const contentPath = path.join(DATA, 'learning-content.json');
const overridePath = path.join(DATA, 'micro-chunk-overrides.json');
const makePath = path.join(DATA, 'make-chunk-overrides.json');
const content = JSON.parse(await readFile(contentPath, 'utf8'));
const draft = JSON.parse(await readFile(overridePath, 'utf8'));
const sourceById = new Map(content.items.map(item => [item.id, item]));
const finalById = new Map();

for (const item of draft.items) {
  const source = sourceById.get(item.id);
  if (!source) throw new Error(`${item.id}: 원문 문장 누락`);
  const correction = manualCorrections[item.id];
  const [microChunks, microOrderGlosses] = correction || [item.microChunks, item.microOrderGlosses];
  if (joinChunks(microChunks) !== source.english) throw new Error(`${item.id}: 영어 원문 복원 실패`);
  if (microChunks.length !== microOrderGlosses.length || !microOrderGlosses.every(Boolean)) {
    throw new Error(`${item.id}: 영어·한국어 발판 1:1 대응 실패`);
  }
  finalById.set(item.id, {
    id: item.id,
    microChunks,
    microOrderGlosses,
  });
}

if (finalById.size !== content.items.length) throw new Error(`전수 검토 수 불일치: ${finalById.size}/${content.items.length}`);

for (const item of content.items) {
  const reviewed = finalById.get(item.id);
  item.microChunks = reviewed.microChunks;
  item.microOrderGlosses = reviewed.microOrderGlosses;
  item.microChunkReview = {
    rulesVersion: 3,
    reviewStatus: 'reviewed',
    reviewMethod: 'codex_theory_guided_full_micro_review',
  };
}
content.microChunkRulesVersion = 3;
content.microChunkReviewCount = content.items.length;
content.microChunkReviewMethod = 'codex_theory_guided_full_micro_review';

draft.schemaVersion = 2;
draft.reviewStatus = 'reviewed';
draft.reviewMethod = 'codex_theory_guided_full_micro_review';
draft.reviewCount = finalById.size;
draft.items = content.items.map(item => finalById.get(item.id));

const make = JSON.parse(await readFile(makePath, 'utf8'));
for (const item of make.items) {
  const reviewed = finalById.get(item.id);
  if (!reviewed) continue;
  item.microChunks = reviewed.microChunks;
  item.microOrderGlosses = reviewed.microOrderGlosses;
}
make.schemaVersion = 3;
make.reviewMethod = 'codex_theory_guided_full_micro_review';

await writeFile(contentPath, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
await writeFile(overridePath, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
await writeFile(makePath, `${JSON.stringify(make, null, 2)}\n`, 'utf8');
process.stdout.write(`첫 노출 의미 발판 전수 교정 완료: ${finalById.size}문장, 직접 수정 ${Object.keys(manualCorrections).length}문장\n`);
