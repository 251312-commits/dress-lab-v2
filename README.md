# dress-lab-v2

분리된 신체 PNG를 원본 좌표로 겹쳐 표시하는 Dress Lab V2의 초기 웹 화면이다.

## 작동 방식

- `base/` 안에 동일한 픽셀 크기와 좌표로 제작된 **투명 배경 PNG** 파일을 넣는다.
- 파일명 앞의 숫자가 레이어 순서다. **숫자가 작을수록 앞에 표시된다.** 예: `01-Head.PNG`는 `17-Hand(R).PNG` 위에 놓인다.
- `Full.PNG`는 관절 위치 참고 자료이므로 **캐릭터 합성에서 제외**한다.
- 각 파츠를 원본 이미지와 같은 좌표 `(0, 0)`에 그린다. 부분 확대·이동·왜곡은 적용하지 않는다.
- 화면 전체를 합성된 캐릭터 이미지로 채운다. 제목·여백·테두리·상태 텍스트는 화면에 표시하지 않는다.
- 파츠 합성은 원본 픽셀 좌표로 수행하고, 화면 표시에서는 비율을 유지하는 `object-fit: cover`를 적용한다. 화면과 원본의 비율이 다르면 가장자리가 일부 잘릴 수 있다.
- 사이트를 열 때 공개 GitHub API를 통해 `base/` 폴더의 숫자로 시작하는 PNG 파일을 찾아 자동 반영한다. API 접근이 불가능하면 `index.html`에 기록한 초기 17개 파츠를 사용한다.

## 웹사이트 공개 (GitHub Pages)

GitHub 저장소에서 **Settings → Pages → Build and deployment → Deploy from a branch → main / (root) → Save** 순으로 설정한다.

페이지가 공개되면 주소는 다음과 같다.

https://251312-commits.github.io/dress-lab-v2/

GitHub Pages가 활성화되지 않은 상태에서는 웹 주소가 열리지 않는다.

## 로컬 미리보기

저장소 폴더에서 `python3 -m http.server 8000`을 실행하고 `http://localhost:8000`으로 접속한다.
