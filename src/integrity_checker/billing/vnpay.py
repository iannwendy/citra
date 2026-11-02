"""VNPay Payment Gateway v2.1.0 Integration (HMAC-SHA512, ReturnURL, IPN Webhook & Sandbox).

Implements the official VNPay Payment Gateway v2.1.0 specification
(https://sandbox.vnpayment.vn/apis/ & https://vnpay.js.org/en/):
- ``build_payment_url``: Alphabetical parameter sorting, RFC-compliant URL encoding,
  VND*100 integer scaling, GMT+7 timestamps (``vnp_CreateDate`` / ``vnp_ExpireDate``),
  and HMAC-SHA512 ``vnp_SecureHash`` generation.
- ``verify_return_url``: Constant-time HMAC-SHA512 signature verification
  (``hmac.compare_digest``), algorithm downgrade prevention, response code &
  transaction status validation.
- ``verify_ipn_call``: Server-to-server Instant Payment Notification (IPN)
  verification with standard VNPay ``RspCode`` responses (``00``, ``01``, ``02``,
  ``04``, ``97``, ``99``).
- ``build_signed_return_params``: Generates cryptographically signed VNPay v2.1.0
  callback parameters for the Built-in Interactive VNPay Sandbox Gateway.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import os
import re
import secrets
import urllib.parse
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

VNPAY_VERSION = "2.1.0"
VNPAY_COMMAND_PAY = "pay"
VNPAY_CURRENCY = "VND"
VNPAY_DEFAULT_PAYMENT_URL = "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html"
VNPAY_DEFAULT_API_URL = "https://sandbox.vnpayment.vn/merchant_webapi/api/transaction"
VNPAY_DEFAULT_TMN_CODE = "CITRAVNP"
VNPAY_DEFAULT_HASH_SECRET = "CITRAVNPSANDBOXSECRETKEY2026HMAC512"
VNPAY_DEFAULT_USD_TO_VND_RATE = 25000

VN_TZ = timezone(timedelta(hours=7))

# Official VNPay v2.1.0 Bank & Payment Channel Codes
VNPAY_SUPPORTED_BANKS: tuple[dict[str, str], ...] = (
    {
        "code": "NCB",
        "name_vi": "Ngân hàng Quốc Dân (NCB - Thẻ Test Sandbox)",
        "name_en": "National Citizen Bank (NCB - Official Sandbox Test)",
        "channel": "atm",
        "short_name": "NCB",
    },
    {
        "code": "VNPAYQR",
        "name_vi": "Quét mã VNPAY-QR / VietQR (40+ Ngân hàng & Ví)",
        "name_en": "VNPAY-QR / VietQR Scan (40+ Mobile Banking Apps)",
        "channel": "qr",
        "short_name": "VNPAY-QR",
    },
    {
        "code": "VNBANK",
        "name_vi": "Thẻ ATM & Tài khoản Ngân hàng Nội địa (NAPAS)",
        "name_en": "Domestic ATM Card & Vietnam Bank Account (NAPAS)",
        "channel": "atm",
        "short_name": "NAPAS ATM",
    },
    {
        "code": "VIETCOMBANK",
        "name_vi": "Ngân hàng Ngoại thương Việt Nam (Vietcombank)",
        "name_en": "Vietcombank (VCB)",
        "channel": "atm",
        "short_name": "Vietcombank",
    },
    {
        "code": "TECHCOMBANK",
        "name_vi": "Ngân hàng Kỹ thương Việt Nam (Techcombank)",
        "name_en": "Techcombank (TCB)",
        "channel": "atm",
        "short_name": "Techcombank",
    },
    {
        "code": "BIDV",
        "name_vi": "Ngân hàng Đầu tư & Phát triển Việt Nam (BIDV)",
        "name_en": "BIDV Bank",
        "channel": "atm",
        "short_name": "BIDV",
    },
    {
        "code": "VIETINBANK",
        "name_vi": "Ngân hàng Công thương Việt Nam (VietinBank)",
        "name_en": "VietinBank (CTG)",
        "channel": "atm",
        "short_name": "VietinBank",
    },
    {
        "code": "MBBANK",
        "name_vi": "Ngân hàng Quân Đội (MB Bank)",
        "name_en": "MB Bank",
        "channel": "atm",
        "short_name": "MB Bank",
    },
    {
        "code": "ACB",
        "name_vi": "Ngân hàng Á Châu (ACB)",
        "name_en": "Asia Commercial Bank (ACB)",
        "channel": "atm",
        "short_name": "ACB",
    },
    {
        "code": "VPBANK",
        "name_vi": "Ngân hàng Việt Nam Thịnh Vượng (VPBank)",
        "name_en": "VPBank",
        "channel": "atm",
        "short_name": "VPBank",
    },
    {
        "code": "TPBANK",
        "name_vi": "Ngân hàng Tiên Phong (TPBank)",
        "name_en": "TPBank",
        "channel": "atm",
        "short_name": "TPBank",
    },
    {
        "code": "INTCARD",
        "name_vi": "Thẻ thanh toán Quốc tế qua VNPAY (Visa / MasterCard / JCB)",
        "name_en": "International Card via VNPAY (Visa / MasterCard / JCB)",
        "channel": "intcard",
        "short_name": "INTCARD",
    },
)

VNPAY_VALID_BANK_CODES: frozenset[str] = frozenset(
    b["code"] for b in VNPAY_SUPPORTED_BANKS
) | frozenset({"AGRIBANK", "SACOMBANK", "VIB", "HDBANK", "SHB", "EXIMBANK", "OCB", "MSB"})

# Official VNPay Sandbox Test Credentials (https://sandbox.vnpayment.vn/apis/)
VNPAY_SANDBOX_TEST_CARDS: dict[str, dict[str, str]] = {
    "success": {
        "bank_code": "NCB",
        "card_number": "9704198526191432198",
        "card_holder": "NGUYEN VAN A",
        "issue_date": "07/15",
        "otp": "123456",
        "response_code": "00",
        "description_vi": "Thẻ ATM NCB Sandbox hợp lệ (Giao dịch thành công)",
        "description_en": "Valid NCB Sandbox ATM Card (Transaction Succeeded)",
    },
    "insufficient_funds": {
        "bank_code": "NCB",
        "card_number": "9704195798621412",
        "card_holder": "NGUYEN VAN A",
        "issue_date": "07/15",
        "otp": "123456",
        "response_code": "51",
        "description_vi": "Thẻ không đủ số dư để thực hiện giao dịch (Mã lỗi 51)",
        "description_en": "Insufficient account balance (Error Code 51)",
    },
    "locked_card": {
        "bank_code": "NCB",
        "card_number": "9704193360968149",
        "card_holder": "NGUYEN VAN A",
        "issue_date": "07/15",
        "otp": "123456",
        "response_code": "12",
        "description_vi": "Thẻ/Tài khoản bị khóa (Mã lỗi 12)",
        "description_en": "Card or account is locked (Error Code 12)",
    },
    "no_internet_banking": {
        "bank_code": "NCB",
        "card_number": "9704192181368742",
        "card_holder": "NGUYEN VAN A",
        "issue_date": "07/15",
        "otp": "123456",
        "response_code": "09",
        "description_vi": "Chưa đăng ký dịch vụ Internet Banking (Mã lỗi 09)",
        "description_en": "Internet Banking not registered (Error Code 09)",
    },
}

# Official VNPay v2.1.0 Response Code Catalog
VNPAY_RESPONSE_CODES: dict[str, dict[str, str]] = {
    "00": {
        "en": "Transaction succeeded.",
        "vi": "Giao dịch thanh toán thành công.",
    },
    "07": {
        "en": "Debited successfully, but transaction is flagged as suspicious by VNPay fraud guard.",
        "vi": "Trừ tiền thành công. Giao dịch bị nghi ngờ (liên quan tới lừa đảo, giao dịch bất thường).",
    },
    "09": {
        "en": "Customer's card/account has not registered for Internet Banking at the bank.",
        "vi": "Thẻ/Tài khoản của khách hàng chưa đăng ký dịch vụ InternetBanking tại ngân hàng.",
    },
    "10": {
        "en": "Customer entered incorrect card/account authentication details more than 3 times.",
        "vi": "Khách hàng xác thực thông tin thẻ/tài khoản không đúng quá 3 lần.",
    },
    "11": {
        "en": "Payment session has expired. Please initiate a new transaction.",
        "vi": "Đã hết hạn chờ thanh toán. Xin quý khách vui lòng thực hiện lại giao dịch.",
    },
    "12": {
        "en": "Customer's card or bank account is currently locked.",
        "vi": "Thẻ/Tài khoản của khách hàng đang bị khóa.",
    },
    "13": {
        "en": "Incorrect OTP authentication password. Please check and try again.",
        "vi": "Quý khách nhập sai mật khẩu xác thực giao dịch (OTP). Xin quý khách vui lòng thực hiện lại.",
    },
    "24": {
        "en": "Customer canceled the payment transaction.",
        "vi": "Khách hàng hủy giao dịch thanh toán.",
    },
    "51": {
        "en": "Insufficient account balance to complete the transaction.",
        "vi": "Tài khoản của quý khách không đủ số dư để thực hiện giao dịch.",
    },
    "65": {
        "en": "Account has exceeded the daily transaction limit.",
        "vi": "Tài khoản của Quý khách đã vượt quá hạn mức giao dịch trong ngày.",
    },
    "75": {
        "en": "The issuing bank is currently under maintenance.",
        "vi": "Ngân hàng thanh toán đang bảo trì.",
    },
    "79": {
        "en": "Customer entered payment password incorrectly too many times.",
        "vi": "KH nhập sai mật khẩu thanh toán quá số lần quy định.",
    },
    "99": {
        "en": "Other payment error or unspecified failure.",
        "vi": "Các lỗi khác (lỗi còn lại, không có trong danh sách mã lỗi đã liệt kê).",
    },
}

# Standard VNPay IPN Response Payloads (matching vnpay.js.org & sandbox.vnpayment.vn)
IpnSuccess = {"RspCode": "00", "Message": "Confirm Success"}
IpnOrderNotFound = {"RspCode": "01", "Message": "Order not found"}
IpnOrderAlreadyConfirmed = {"RspCode": "02", "Message": "Order already confirmed"}
IpnInvalidAmount = {"RspCode": "04", "Message": "Invalid amount"}
IpnFailChecksum = {"RspCode": "97", "Message": "Invalid Checksum"}
IpnUnknownError = {"RspCode": "99", "Message": "Unknown error"}


@dataclass(frozen=True)
class VNPayVerifyResult:
    """Structured result of verifying a VNPay ReturnURL or IPN request."""

    is_verified: bool
    is_success: bool
    response_code: str
    transaction_status: str
    txn_ref: str
    amount_vnd: int
    raw_vnp_amount: int
    bank_code: str
    bank_tran_no: str
    card_type: str
    transaction_no: str
    pay_date: str
    order_info: str
    tmn_code: str
    message_en: str
    message_vi: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "is_verified": self.is_verified,
            "is_success": self.is_success,
            "vnp_ResponseCode": self.response_code,
            "vnp_TransactionStatus": self.transaction_status,
            "vnp_TxnRef": self.txn_ref,
            "amount_vnd": self.amount_vnd,
            "vnp_Amount": self.raw_vnp_amount,
            "vnp_BankCode": self.bank_code,
            "vnp_BankTranNo": self.bank_tran_no,
            "vnp_CardType": self.card_type,
            "vnp_TransactionNo": self.transaction_no,
            "vnp_PayDate": self.pay_date,
            "vnp_OrderInfo": self.order_info,
            "vnp_TmnCode": self.tmn_code,
            "message_en": self.message_en,
            "message_vi": self.message_vi,
        }


def sanitize_order_info(text: str) -> str:
    """Sanitize vnp_OrderInfo to ASCII alphanumeric & safe punctuation per VNPay v2.1.0 spec."""
    cleaned = re.sub(r"[^A-Za-z0-9 _.\-:/()]", " ", text or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return (cleaned or "Thanh toan goi CITRA")[:250]


def sanitize_client_ip(raw_ip: str | None) -> str:
    """Return a clean IPv4 address for vnp_IpAddr (VNPay v2.1.0 requires valid IPv4)."""
    if not raw_ip:
        return "127.0.0.1"
    first_ip = raw_ip.split(",")[0].strip()
    try:
        parsed = ipaddress.ip_address(first_ip)
        if isinstance(parsed, ipaddress.IPv4Address):
            return str(parsed)
        if isinstance(parsed, ipaddress.IPv6Address) and parsed.ipv4_mapped:
            return str(parsed.ipv4_mapped)
    except ValueError:
        pass
    return "127.0.0.1"


def get_vnpay_response_message(code: str) -> tuple[str, str]:
    """Return (message_en, message_vi) for a VNPay vnp_ResponseCode."""
    entry = VNPAY_RESPONSE_CODES.get((code or "").strip(), VNPAY_RESPONSE_CODES["99"])
    return entry["en"], entry["vi"]


class VNPayService:
    """Cryptographic VNPay Payment Gateway v2.1.0 service (modeled after vnpay.js.org)."""

    def __init__(
        self,
        tmn_code: str | None = None,
        hash_secret: str | None = None,
        payment_url: str | None = None,
        api_url: str | None = None,
        return_url: str | None = None,
        usd_to_vnd_rate: int | None = None,
        external_redirect: bool | None = None,
    ) -> None:
        self.tmn_code = (
            tmn_code
            or os.getenv("VNPAY_TMN_CODE", "").strip()
            or VNPAY_DEFAULT_TMN_CODE
        )
        self.hash_secret = (
            hash_secret
            or os.getenv("VNPAY_HASH_SECRET", "").strip()
            or VNPAY_DEFAULT_HASH_SECRET
        )
        self.payment_url = (
            payment_url
            or os.getenv("VNPAY_PAYMENT_URL", "").strip()
            or VNPAY_DEFAULT_PAYMENT_URL
        )
        self.api_url = (
            api_url
            or os.getenv("VNPAY_API_URL", "").strip()
            or VNPAY_DEFAULT_API_URL
        )
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
        self.return_url = (
            return_url
            or os.getenv("VNPAY_RETURN_URL", "").strip()
            or f"{frontend_url}/billing/success"
        )
        raw_rate = usd_to_vnd_rate or int(os.getenv("VNPAY_USD_TO_VND_RATE", str(VNPAY_DEFAULT_USD_TO_VND_RATE)) or VNPAY_DEFAULT_USD_TO_VND_RATE)
        self.usd_to_vnd_rate = max(1000, int(raw_rate))

        if external_redirect is not None:
            self.external_redirect = external_redirect
        else:
            env_ext = os.getenv("VNPAY_EXTERNAL_REDIRECT", "").strip().lower()
            self.external_redirect = env_ext in ("1", "true", "yes", "on")

    def usd_to_vnd(self, amount_usd: float) -> int:
        """Convert USD plan price to integer VND amount using configured exchange rate."""
        if amount_usd <= 0:
            return 0
        return int(round(float(amount_usd) * self.usd_to_vnd_rate))

    @staticmethod
    def compute_hmac_sha512(secret_key: str, sign_data: str) -> str:
        """Compute lowercase hexadecimal HMAC-SHA512 digest per VNPay v2.1.0 specification."""
        return hmac.new(
            secret_key.encode("utf-8"),
            sign_data.encode("utf-8"),
            hashlib.sha512,
        ).hexdigest()

    @staticmethod
    def build_sorted_query_string(params: Mapping[str, Any]) -> str:
        """Sort vnp_* parameters alphabetically by key and URL-encode with quote_plus."""
        clean_items: list[tuple[str, str]] = []
        for k, v in params.items():
            if not k or k in ("vnp_SecureHash", "vnp_SecureHashType"):
                continue
            if v is None:
                continue
            str_v = str(v).strip()
            if str_v == "":
                continue
            clean_items.append((str(k), str_v))

        clean_items.sort(key=lambda item: item[0])
        return "&".join(
            f"{urllib.parse.quote_plus(k, safe='')}={urllib.parse.quote_plus(v, safe='')}"
            for k, v in clean_items
        )

    def build_payment_url(
        self,
        *,
        txn_ref: str,
        amount_usd: float,
        order_info: str,
        ip_addr: str = "127.0.0.1",
        bank_code: str | None = None,
        locale: str = "vn",
        order_type: str = "other",
        return_url: str | None = None,
        create_date: datetime | None = None,
        expire_minutes: int = 15,
    ) -> dict[str, Any]:
        """Build a signed VNPay v2.1.0 payment URL and return full metadata."""
        now_vn = (create_date or datetime.now(VN_TZ)).astimezone(VN_TZ)
        expire_vn = now_vn + timedelta(minutes=max(5, expire_minutes))

        amount_vnd = self.usd_to_vnd(amount_usd)
        # VNPay requires vnp_Amount multiplied by 100 (and at least 5,000 VND for non-zero payments)
        vnp_amount_scaled = int(amount_vnd * 100)

        clean_locale = "en" if (locale or "").strip().lower() == "en" else "vn"
        clean_ip = sanitize_client_ip(ip_addr)
        clean_info = sanitize_order_info(order_info)
        effective_return_url = (return_url or self.return_url).strip()

        vnp_params: dict[str, str] = {
            "vnp_Version": VNPAY_VERSION,
            "vnp_Command": VNPAY_COMMAND_PAY,
            "vnp_TmnCode": self.tmn_code,
            "vnp_Amount": str(vnp_amount_scaled),
            "vnp_CurrCode": VNPAY_CURRENCY,
            "vnp_TxnRef": txn_ref.strip(),
            "vnp_OrderInfo": clean_info,
            "vnp_OrderType": (order_type or "other").strip(),
            "vnp_Locale": clean_locale,
            "vnp_ReturnUrl": effective_return_url,
            "vnp_IpAddr": clean_ip,
            "vnp_CreateDate": now_vn.strftime("%Y%m%d%H%M%S"),
            "vnp_ExpireDate": expire_vn.strftime("%Y%m%d%H%M%S"),
        }

        if bank_code and bank_code.strip():
            normalized_bank = bank_code.strip().upper()
            if normalized_bank not in VNPAY_VALID_BANK_CODES:
                raise ValueError(f"Unsupported VNPay bank_code: {normalized_bank}")
            vnp_params["vnp_BankCode"] = normalized_bank

        query_string = self.build_sorted_query_string(vnp_params)
        secure_hash = self.compute_hmac_sha512(self.hash_secret, query_string)
        full_url = f"{self.payment_url}?{query_string}&vnp_SecureHash={secure_hash}"

        return {
            "payment_url": full_url,
            "vnp_txn_ref": vnp_params["vnp_TxnRef"],
            "vnp_amount": vnp_amount_scaled,
            "amount_vnd": amount_vnd,
            "amount_usd": round(float(amount_usd), 2),
            "usd_to_vnd_rate": self.usd_to_vnd_rate,
            "tmn_code": self.tmn_code,
            "vnp_tmn_code": self.tmn_code,
            "bank_code": vnp_params.get("vnp_BankCode", ""),
            "vnp_bank_code": vnp_params.get("vnp_BankCode", ""),
            "vnp_locale": clean_locale,
            "create_date": vnp_params["vnp_CreateDate"],
            "vnp_create_date": vnp_params["vnp_CreateDate"],
            "expire_date": vnp_params["vnp_ExpireDate"],
            "vnp_expire_date": vnp_params["vnp_ExpireDate"],
            "order_info": clean_info,
            "vnp_secure_hash": secure_hash,
            "vnp_params": {**vnp_params, "vnp_SecureHash": secure_hash},
            "external_redirect": self.external_redirect,
        }

    def verify_return_url(self, query_params: Mapping[str, Any]) -> VNPayVerifyResult:
        """Verify HMAC-SHA512 checksum and transaction status from VNPay ReturnURL or IPN."""
        received_hash = str(query_params.get("vnp_SecureHash") or "").strip()
        hash_type = str(query_params.get("vnp_SecureHashType") or "").strip().upper()

        txn_ref = str(query_params.get("vnp_TxnRef") or "").strip()
        response_code = str(query_params.get("vnp_ResponseCode") or "99").strip()
        transaction_status = str(
            query_params.get("vnp_TransactionStatus") or response_code
        ).strip()
        bank_code = str(query_params.get("vnp_BankCode") or "").strip().upper()
        bank_tran_no = str(query_params.get("vnp_BankTranNo") or "").strip()
        card_type = str(query_params.get("vnp_CardType") or "ATM").strip().upper()
        transaction_no = str(query_params.get("vnp_TransactionNo") or "").strip()
        pay_date = str(query_params.get("vnp_PayDate") or "").strip()
        order_info = str(query_params.get("vnp_OrderInfo") or "").strip()
        tmn_code = str(query_params.get("vnp_TmnCode") or "").strip()

        raw_amount_str = str(query_params.get("vnp_Amount") or "0").strip()
        try:
            raw_vnp_amount = int(raw_amount_str)
        except ValueError:
            raw_vnp_amount = -1
        amount_vnd = raw_vnp_amount // 100 if raw_vnp_amount >= 0 else -1

        # Reject missing signature or downgraded hash algorithm (must be SHA512 / HMACSHA512)
        if not received_hash or len(received_hash) != 128:
            return VNPayVerifyResult(
                is_verified=False,
                is_success=False,
                response_code=response_code,
                transaction_status=transaction_status,
                txn_ref=txn_ref,
                amount_vnd=amount_vnd,
                raw_vnp_amount=raw_vnp_amount,
                bank_code=bank_code,
                bank_tran_no=bank_tran_no,
                card_type=card_type,
                transaction_no=transaction_no,
                pay_date=pay_date,
                order_info=order_info,
                tmn_code=tmn_code,
                message_en="Invalid or missing VNPay HMAC-SHA512 checksum signature.",
                message_vi="Chữ ký bảo mật VNPay (vnp_SecureHash) không hợp lệ hoặc bị thiếu.",
            )

        if hash_type and hash_type not in ("SHA512", "HMACSHA512"):
            return VNPayVerifyResult(
                is_verified=False,
                is_success=False,
                response_code=response_code,
                transaction_status=transaction_status,
                txn_ref=txn_ref,
                amount_vnd=amount_vnd,
                raw_vnp_amount=raw_vnp_amount,
                bank_code=bank_code,
                bank_tran_no=bank_tran_no,
                card_type=card_type,
                transaction_no=transaction_no,
                pay_date=pay_date,
                order_info=order_info,
                tmn_code=tmn_code,
                message_en=f"Unsupported vnp_SecureHashType '{hash_type}'. Only HMAC-SHA512 is permitted.",
                message_vi=f"Thuật toán ký '{hash_type}' không được phép. Chỉ chấp nhận HMAC-SHA512.",
            )

        # Only include vnp_* parameters when reconstructing the canonical signed string
        vnp_only_params = {
            k: v
            for k, v in query_params.items()
            if str(k).startswith("vnp_")
            and k not in ("vnp_SecureHash", "vnp_SecureHashType")
        }
        if not vnp_only_params:
            return VNPayVerifyResult(
                is_verified=False,
                is_success=False,
                response_code=response_code,
                transaction_status=transaction_status,
                txn_ref=txn_ref,
                amount_vnd=amount_vnd,
                raw_vnp_amount=raw_vnp_amount,
                bank_code=bank_code,
                bank_tran_no=bank_tran_no,
                card_type=card_type,
                transaction_no=transaction_no,
                pay_date=pay_date,
                order_info=order_info,
                tmn_code=tmn_code,
                message_en="No vnp_* parameters found in callback payload.",
                message_vi="Không tìm thấy tham số vnp_* trong dữ liệu phản hồi.",
            )

        sign_data = self.build_sorted_query_string(vnp_only_params)
        expected_hash = self.compute_hmac_sha512(self.hash_secret, sign_data)
        is_verified = hmac.compare_digest(expected_hash.lower(), received_hash.lower())

        if not is_verified:
            return VNPayVerifyResult(
                is_verified=False,
                is_success=False,
                response_code=response_code,
                transaction_status=transaction_status,
                txn_ref=txn_ref,
                amount_vnd=amount_vnd,
                raw_vnp_amount=raw_vnp_amount,
                bank_code=bank_code,
                bank_tran_no=bank_tran_no,
                card_type=card_type,
                transaction_no=transaction_no,
                pay_date=pay_date,
                order_info=order_info,
                tmn_code=tmn_code,
                message_en="VNPay checksum verification failed (vnp_SecureHash mismatch).",
                message_vi="Xác thực chữ ký bảo mật VNPay thất bại (sai lệch vnp_SecureHash).",
            )

        is_success = response_code == "00" and transaction_status == "00" and raw_vnp_amount >= 0
        msg_en, msg_vi = get_vnpay_response_message(
            response_code if response_code != "00" else transaction_status
        )

        return VNPayVerifyResult(
            is_verified=True,
            is_success=is_success,
            response_code=response_code,
            transaction_status=transaction_status,
            txn_ref=txn_ref,
            amount_vnd=amount_vnd,
            raw_vnp_amount=raw_vnp_amount,
            bank_code=bank_code,
            bank_tran_no=bank_tran_no,
            card_type=card_type,
            transaction_no=transaction_no,
            pay_date=pay_date,
            order_info=order_info,
            tmn_code=tmn_code,
            message_en=msg_en,
            message_vi=msg_vi,
        )

    def verify_ipn_call(self, query_params: Mapping[str, Any]) -> VNPayVerifyResult:
        """Verify server-to-server IPN webhook call from VNPay."""
        return self.verify_return_url(query_params)

    def build_signed_return_params(
        self,
        *,
        txn_ref: str | None = None,
        vnp_txn_ref: str | None = None,
        amount_vnd: int = 0,
        order_info: str = "Thanh toan goi CITRA",
        bank_code: str = "NCB",
        card_type: str = "ATM",
        response_code: str = "00",
        transaction_status: str | None = None,
        transaction_no: str | None = None,
        bank_tran_no: str | None = None,
        pay_date: datetime | None = None,
    ) -> dict[str, str]:
        """Construct a cryptographically signed VNPay v2.1.0 callback parameter dict for Sandbox testing."""
        effective_ref = (txn_ref or vnp_txn_ref or "").strip()
        now_vn = (pay_date or datetime.now(VN_TZ)).astimezone(VN_TZ)
        effective_status = (
            transaction_status if transaction_status is not None else response_code
        )
        tx_no = transaction_no or f"14{secrets.randbelow(900000) + 100000}"
        b_tran_no = bank_tran_no or f"VNP{ tx_no }"

        params: dict[str, str] = {
            "vnp_Amount": str(int(amount_vnd * 100)),
            "vnp_BankCode": (bank_code or "NCB").strip().upper(),
            "vnp_BankTranNo": b_tran_no,
            "vnp_CardType": (card_type or "ATM").strip().upper(),
            "vnp_OrderInfo": sanitize_order_info(order_info),
            "vnp_PayDate": now_vn.strftime("%Y%m%d%H%M%S"),
            "vnp_ResponseCode": response_code.strip(),
            "vnp_TmnCode": self.tmn_code,
            "vnp_TransactionNo": tx_no,
            "vnp_TransactionStatus": effective_status.strip(),
            "vnp_TxnRef": effective_ref,
        }
        sign_data = self.build_sorted_query_string(params)
        secure_hash = self.compute_hmac_sha512(self.hash_secret, sign_data)
        params["vnp_SecureHash"] = secure_hash
        return params


def get_vnpay_service() -> VNPayService:
    """Return a configured VNPayService instance."""
    return VNPayService()

