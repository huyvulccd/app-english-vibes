# SayBack

Web học tiếng Anh chạy trên GitHub Pages: <https://huyvulccd.github.io/app-english-vibes/>. Trang chủ có bốn khu luyện tập; trang giáo trình và danh sách phát âm cũ vẫn có đường dẫn riêng. Ứng dụng chỉ dùng HTML, CSS, JavaScript và dữ liệu JSON tĩnh. Không cần tài khoản hoặc máy chủ ứng dụng.

## Các khu học

### Từ vựng B1–C2

Kho có 3.947 từ: B1 (1.125), B2 (1.444), C1 (710), C2 (668). Mỗi lượt lấy tối đa 10 từ đến hạn hoặc từ mới. Mỗi từ đi qua bốn bước:

1. Nhìn từ tiếng Anh và chọn nghĩa tiếng Việt trong bốn đáp án.
2. Nghe từ bằng giọng đọc của trình duyệt và chọn một trong bốn từ tiếng Anh.
3. Nhìn nghĩa tiếng Việt và viết lại từ tiếng Anh.
4. Nghe mẫu, ghi âm, nghe lại và tự đánh giá phát âm.

Từ trả lời sai được hẹn ôn lại sau một phút. Từ trả lời đúng được hẹn theo khoảng ngày tăng dần, tùy mức tự đánh giá. Người học có thể tìm từ, sửa nghĩa, thêm từ riêng. Tiến độ và nghĩa đã sửa lưu trong `localStorage`; bản ghi âm từ vựng lưu trong `IndexedDB` của trình duyệt.

Cấp độ từ lấy từ [CEFR-J Vocabulary Profile và Octanove C1/C2](https://github.com/openlanguageprofiles/olp-en-cefrj). Nghĩa tiếng Việt lấy từ [thichhoc-dict](https://github.com/thichhoc-org/thichhoc-dict). Nghĩa do AI tạo ở nguồn, vì vậy nên kiểm tra và sửa trước khi học. Thông tin giấy phép và ghi nguồn ở [`VOCABULARY-LICENSE.md`](VOCABULARY-LICENSE.md).

### Shadowing

Chọn tin tiếng Anh của BBC News, Viet Nam News hoặc VnExpress International; bấm **Tải toàn bài đã chọn**, dán link, lấy bài ngẫu nhiên, hoặc dán văn bản của mình. Trang chia nội dung thành các đoạn theo dấu câu; từng đoạn có nút nghe mẫu, tốc độ nghe, ghi âm và phát lại. Bản ghi được giữ khi chuyển qua lại giữa các đoạn và bài trong phiên mở trang. Khi đóng hoặc tải lại trang, bản ghi Shadowing mất theo chủ ý.

### Chép chính tả

Dùng cùng cách chọn bài tiếng Anh, gồm tải toàn bài online, dán link hoặc lấy ngẫu nhiên. Nghe từng đoạn ở tốc độ 1× hoặc 0,75×, viết câu trả lời, chuyển đoạn mà không mất phần đã viết trong phiên. Khi kết thúc, trang đối chiếu từng từ, tô đỏ từ sai/thiếu, gạch từ viết thêm và hiển thị tỷ lệ chính xác toàn bài. Từ trong bài được liệt kê để người học tích chọn, nhập hoặc sửa nghĩa và đưa vào lịch ôn từ vựng. Bài chép đang làm chỉ được giữ trong phiên mở trang.

### Dịch Anh ↔ Việt

Chọn tin tiếng Anh hoặc tin tiếng Việt, tải toàn bài online, dán link, lấy bài ngẫu nhiên, hay dán văn bản riêng. Bài gốc và ô dịch hiển thị cạnh nhau trên màn hình rộng. Nút sao chép tạo prompt gồm bài gốc, bản dịch và yêu cầu chấm; người học dán vào AI họ chọn. Trang không gửi nội dung dịch đến dịch vụ AI. Bản nháp được giữ khi đổi bài hoặc đổi chiều dịch trong phiên mở trang.

## Nguồn tin và cập nhật

`news-data.json` chứa **tiêu đề và tóm tắt RSS**, kèm tên nguồn, ngày và liên kết đến bài gốc. Đây là danh sách để chọn nhanh; các nút tải toàn bài, dán link và lấy ngẫu nhiên dùng [Jina Reader API](https://jina.ai/reader/) để lấy văn bản chính trực tiếp vào trình duyệt khi người học yêu cầu. Văn bản toàn bài chỉ được giữ trong phiên mở trang, không xuất bản trong repository. Một số trang có thể chặn dịch vụ đọc bài hoặc thay đổi bố cục; khi đó có thể mở bài gốc và dán nội dung vào ô riêng. Dữ liệu RSS từ [BBC News](https://support.bbc.co.uk/platform/feeds/NewsFeeds.htm), [Viet Nam News](https://vietnamnews.vn/rss), [VnExpress International](https://e.vnexpress.net/rss) và [VnExpress](https://vnexpress.net/rss). GitHub Actions chạy `scripts/build-news.mjs` hằng ngày để cập nhật danh sách và tự commit nếu có tin mới. Có thể chạy thủ công từ tab Actions hoặc tại máy:

```powershell
node scripts/build-news.mjs
```

Kho từ vựng được tạo trước rồi xuất bản như tệp tĩnh, không phải gọi API mỗi lần mở trang. Muốn tạo lại từ nguồn:

```powershell
node scripts/build-vocabulary.mjs
```

Script tải các danh sách CEFR-J/Octanove và các phần từ điển, giữ các nghĩa có độ tin cậy cao hoặc trung bình, rồi tạo `vocabulary-data.json`. Bản tải tạm được giữ trong `SOURCE/vocabulary-cache/` và không đưa lên Git. Hai tệp JSON nằm trong bộ nhớ đệm của service worker sau lần tải thành công, nên có thể mở lại khi mất mạng; tải toàn bài online và tin mới cần mạng. Link do người học dán được gửi tới Jina Reader để trích văn bản. Giọng đọc phụ thuộc các giọng cài trong trình duyệt/hệ điều hành; trình duyệt không có giọng phù hợp sẽ không phát mẫu.

## Giáo trình và phát âm cũ

[`study.html`](study.html) chuyển 203 PDF New English File thành 3.370 trang học cho sáu cấp độ từ Beginner đến Advanced, với 5.206 track nghe. Người học có thể tìm bài, xem ảnh trang, dùng OCR để tìm văn bản, chọn đoạn để luyện phát âm, ghi chú, lưu câu trả lời và theo dõi tiến độ. Văn bản OCR có thể sai; ảnh trang là bản đối chiếu. Audio chưa phát trước đó cần mạng để tải lần đầu.

[`pronunciation.html`](pronunciation.html) là danh sách từ/câu do người học tự nhập trước đây. IPA, nghĩa, ví dụ và dữ liệu cá nhân tiếp tục nằm trong trình duyệt cũ; đường dẫn từ trang giáo trình vẫn mở công cụ này. Web cho nghe mẫu và ghi âm để tự so sánh, không tự chấm chính xác từng âm. [`course.html`](course.html) là trang duyệt kho tệp gốc trên máy người dùng.

## Tạo lại nội dung giáo trình

Các tệp gốc ở `SOURCE/extracted/New-english-file/` không đưa lên Git. Cần Python với `PyMuPDF`, `Pillow`, Tesseract OCR và FFmpeg/FFprobe.

```powershell
python -m pip install PyMuPDF Pillow
python scripts/build_web_course.py --workers 4
python scripts/build_lesson_audio.py
node scripts/validate-study-assets.mjs
node scripts/deploy_lesson_audio.mjs --execute
```

`build_web_course.py` tạo ảnh trang và dữ liệu bài học. `build_lesson_audio.py` tạo danh mục audio và các MP3 đã chuyển đổi. Script deploy audio xuất bản sáu repository Pages riêng theo cấp độ; trang chính chỉ tham chiếu URL của chúng.

## Kiểm tra

```powershell
node --test tests/practice-core.test.mjs tests/reader-core.test.mjs tests/research-parser.test.mjs
node scripts/check-practice-browser.mjs
$env:PRACTICE_ONLINE='1'; node scripts/check-practice-browser.mjs
node scripts/validate-study-assets.mjs
node scripts/check-study-browser.mjs
```

Hai bài kiểm tra trình duyệt dùng Chrome và tự mở một máy chủ tĩnh cục bộ. Bài kiểm tra trang mới đi qua bốn bước học từ, ghi âm và nghe lại, Shadowing, chép chính tả, lưu từ, hai prompt dịch. `PRACTICE_ONLINE=1` còn kiểm tra tải bài BBC/Viet Nam News/VnExpress và lấy ngẫu nhiên qua mạng. Bài kiểm tra giáo trình kiểm tra ảnh, tiến độ, câu trả lời, ghi chú và chuyển các cấp độ.
