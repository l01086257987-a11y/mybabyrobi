# 우리의 첫 장면

생일 선물용 웹사이트예요. 영화 티켓 모양 입장 화면에서 **처음 만난 날짜**를 맞혀야 열립니다.

화면은 이 순서로 이어져요: 입장 → 꽃 오프닝 → S#1 첫 만남 영상 → S#2 함께한 날들 → S#3 편지 → S#4 케이크 → 엔딩 크레딧

편지, 사진, 영상은 입장 날짜를 비밀번호로 써서 **암호화한 상태로** 올라가요. 그래서 공개 저장소에 올려도 GitHub에서 내용을 볼 수 없어요.

## 폴더 구조

```
index.html          화면 뼈대
assets/             디자인(style.css)과 동작(app.js)
data/               암호화된 내용  ← 깃허브에 올라감
private/            원본 편지·사진·영상  ← 깃허브에 안 올라감 (.gitignore)
  content.json      모든 글과 날짜
  media/            사진, 영상, 음악 원본
tools/encrypt.mjs   private → data 로 암호화
tools/decrypt.mjs   data → private 로 복구
```

## 내용 바꾸기

1. `private/content.json`에서 글과 날짜를 고쳐요.
   - `password`: 입장 비밀번호로 쓸 날짜
   - `question`: 입장 화면 질문 (예: "우리가 사귄 날은?")
   - `hint`: 두 번 틀리면 보여줄 힌트
   - `question`과 `hint`는 입장 전에 보여야 해서 암호화되지 않아요.
2. 사진과 영상은 `private/media/`에 넣고, content.json에는 `"media/파일이름.jpg"` 형식으로 적어요.
3. 아래 명령으로 암호화해요. Node 18 이상이 필요해요.

```bash
node tools/encrypt.mjs
```

음악을 넣으려면 `"music": "media/song.mp3"`처럼 적으면 돼요. 그러면 오른쪽 위에 음악 버튼이 생겨요.

## 미리보기

파일을 더블클릭해서 열면 동작하지 않아요. 간단한 서버를 띄워서 열어 주세요.

```bash
python3 -m http.server 8000
```

그다음 브라우저에서 http://localhost:8000 을 열면 돼요.

## 깃허브에 올리기

1. GitHub에서 새 저장소를 만들어요. 저장소 이름이 주소가 돼요 (예: `아이디.github.io/our-first-scene`).
2. 이 폴더 전체를 올려요. `private/`는 자동으로 빠져요.
3. 저장소 **Settings → Pages → Branch: `main` / `(root)`** 를 선택하고 저장해요.
4. 1~2분 뒤 위 주소로 접속돼요.

**`private/` 폴더는 깃허브에 안 올라가요.** 그러니 원본은 내 컴퓨터에 따로 꼭 보관해 주세요.

## 영상 팁

- mp4(H.264) 형식이 아이폰, 안드로이드, 카카오톡 브라우저에서 가장 잘 나와요.
- 휴대폰에서 빨리 뜨게 하려면 40MB 이하를 권장해요. 줄이는 방법:

```bash
ffmpeg -i 원본.mp4 -c:v libx264 -crf 24 -preset slow -vf "scale='min(1280,iw)':-2" -c:a aac -b:a 128k -movflags +faststart private/media/first-meet.mp4
```

## 원본을 잃어버렸을 때

깃허브에 올라간 암호 파일에서 원본을 되살릴 수 있어요. 입장 날짜만 알면 돼요.

```bash
node tools/decrypt.mjs 2024.03.12
```

## 보안 수준

장난스러운 잠금 정도라고 생각해 주세요. 날짜는 경우의 수가 적어서 누군가 작정하고 하나씩 넣어 보면 풀릴 수 있어요.
