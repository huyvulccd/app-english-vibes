# SayBack

Web tĩnh để luyện phát âm tiếng Anh với danh sách từ và câu do người dùng tự nhập. Không cần tài khoản, máy chủ ứng dụng hoặc khóa API.

Trang GitHub Pages: <https://huyvulccd.github.io/app-english-vibes/>.

## Sử dụng

1. Mở trang GitHub Pages của dự án (hoặc chạy các tệp trong thư mục bằng một máy chủ tĩnh khi phát triển).
2. Nhập mỗi từ/câu trên một dòng. Có thể thêm nghĩa và IPA theo mẫu `English | nghĩa tiếng Việt | /IPA/`.
3. Một dòng có khoảng trắng được nhận là câu. Với cụm từ muốn lưu như từ vựng, thêm `word:` ở đầu dòng. Có thể đổi loại mục trong phần chi tiết.
4. Chọn mục trong danh sách để sửa thông tin, nghe mẫu, ghi âm và nghe lại. Nút **Tra cứu tự động** chỉ điền các trường còn trống.

Danh sách được lưu bằng `localStorage`; bản ghi âm gần nhất của mỗi mục được lưu bằng `IndexedDB`. Nút **Xuất danh sách** tạo tệp JSON để sao lưu nội dung chữ. Tệp xuất chưa bao gồm bản ghi âm.

## Triển khai trên GitHub Pages

Đưa các tệp trong thư mục này lên nhánh `main` của GitHub. Trong **Settings → Pages**, chọn **Deploy from a branch**, nhánh `main`, thư mục `/ (root)`. Trang hoạt động dưới tên miền GitHub Pages của repository mà không cần backend hoặc bước build. HTTPS của GitHub Pages cho phép trình duyệt xin quyền dùng micro.

Service worker lưu các tệp ứng dụng để dùng lại khi ngoại tuyến sau lần tải đầu. Việc tra thông tin mới vẫn cần mạng. Khi đã lưu trong trình duyệt, danh sách và các bản ghi tiếp tục hoạt động ngoại tuyến. Nút **Nghe mẫu** dùng giọng tiếng Anh cục bộ của trình duyệt/hệ điều hành; nếu thiết bị không có giọng này, cần cài giọng tiếng Anh trên thiết bị.

## Nguồn tra cứu và giới hạn

- [Free Dictionary API](https://dictionaryapi.dev/) cung cấp IPA, loại từ và câu ví dụ cho từ đơn.
- [Datamuse API](https://www.datamuse.com/api/) cung cấp IPA gợi ý và các từ có cùng tiền tố để tham khảo word family. Gợi ý word family không phải kết quả từ điển đã xác minh.
- [MyMemory Translation API](https://mymemory.translated.net/doc/spec.php) cung cấp bản dịch tiếng Việt tham khảo. Bản dịch có thể sai; người học nên kiểm tra và chỉnh sửa.
- IPA của câu được ghép từ IPA từng từ, chưa thể hiện nối âm, nhấn trọng âm câu hay ngữ điệu.
- Web ghi âm và phát lại để tự so sánh; không đưa điểm phát âm tự động vì nhận diện chữ không đủ để chấm từng âm một cách đáng tin cậy.

Không có API key trong mã. Tra cứu công khai có thể bị giới hạn lưu lượng hoặc ngừng hoạt động; nhập và sửa tay vẫn dùng được.
