# SayBack

Web học tiếng Anh và luyện phát âm chạy trực tiếp trên GitHub Pages, không cần máy chủ ứng dụng hay tài khoản. Mở tại <https://huyvulccd.github.io/app-english-vibes/>.

## Học theo giáo trình

Trang [`study.html`](study.html) chuyển nội dung từ 203 PDF New English File thành 3.370 trang học cho sáu cấp độ Beginner, Elementary, Pre-Intermediate, Intermediate, Upper-Intermediate và Advanced. Trang hiển thị ảnh WebP của bài học; văn bản trích xuất và OCR hỗ trợ tìm trong sách, chọn đoạn để luyện phát âm, nhận diện gợi ý bài tập và lưu câu trả lời. Có thể nghe 5.206 track, giảm tốc độ, lặp lại, ghi âm và nghe lại giọng mình. Tiến độ từng trang, ghi chú, câu trả lời và trang gần nhất lưu trong `localStorage` của trình duyệt.

Nội dung được chuyển thành trang web tĩnh, **không nhúng PDF hoặc RAR**. OCR có thể nhận sai chữ trên bản quét; đối chiếu ảnh bài học khi làm bài. Bản ghi âm ở trang giáo trình chỉ phát lại trong phiên đang mở. Những trang và tệp ứng dụng đã xem được service worker lưu để đọc lại khi mất mạng; audio chưa phát trước đó cần mạng để tải lần đầu.

## Luyện phát âm từ và câu

Trang chính [`index.html`](index.html) nhận danh sách từ hoặc câu, mỗi mục một dòng. Có thể tự nhập IPA, nghĩa, loại từ, word family và ví dụ. Khi có mạng, web thử tra IPA và thông tin từ các API công khai; cũng có form dán kết quả Google AI hoặc Cambridge để xem và chọn từng trường trước khi lưu. Dữ liệu chữ lưu trong `localStorage`, bản ghi âm lưu trong `IndexedDB`. Web cho phép nghe mẫu, ghi âm và so sánh bằng tai; không đưa ra điểm phát âm tự động vì nhận diện chữ không đủ tin cậy để chấm từng âm.

Trang [`course.html`](course.html) vẫn là kho duyệt tệp gốc cho người dùng muốn mở tài liệu trên máy của mình. Nó không cần thiết để dùng trang học trực tuyến.

## Tạo lại nội dung từ SOURCE

Các tệp gốc nằm trong `SOURCE/extracted/New-english-file/` và được loại khỏi Git. Cần Python với `PyMuPDF`, `Pillow`, Tesseract OCR (`C:\Program Files\Tesseract-OCR\tesseract.exe`) và FFmpeg/FFprobe trong `PATH`.

```powershell
python -m pip install PyMuPDF Pillow
python scripts/build_web_course.py --workers 4
python scripts/build_lesson_audio.py
node scripts/validate-study-assets.mjs
node scripts/deploy_lesson_audio.mjs --execute
```

`build_web_course.py` tạo `course-pages/` và `lesson-data/`. `build_lesson_audio.py` tạo `lesson-audio.json` và sáu thư mục audio đã chuyển thành MP3 trong `SOURCE/audio-sites/`. Lệnh deploy audio tạo sáu repository công khai ở tài khoản GitHub `huyvulccd`, bật Pages và ghi `lesson-audio-sources.json`; nó dùng thông tin đăng nhập từ Git Credential Manager. Mỗi repo chỉ chứa audio của một cấp độ. Sau đó commit và push repository chính để xuất bản trang học.

## Kiểm tra

```powershell
node --test tests/research-parser.test.mjs
node scripts/validate-study-assets.mjs
node scripts/check-study-browser.mjs
```

Bài kiểm tra trình duyệt cần Chrome và chạy qua máy chủ tĩnh cục bộ do script tự mở. Nó kiểm tra hiển thị trang, chuyển trang, ảnh, lưu câu trả lời và ghi chú, đánh dấu đã học và khôi phục sau khi tải lại.

## Giới hạn

GitHub Pages là hosting tĩnh. Tra cứu thông tin mới và tải audio chưa xem cần Internet. Bài tập trích từ OCR là gợi ý để người học tự trả lời; web không có đáp án chấm tự động. Các API từ điển hoặc dịch miễn phí có thể giới hạn lưu lượng, nên thông tin tra cứu cần được người học kiểm tra trước khi lưu.
