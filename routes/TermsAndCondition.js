import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

const TermsAndConditions = () => {
  const navigate = useNavigate();
  const [agreed, setAgreed] = useState(false);

  const handleAgree = () => {
    if (agreed) navigate("/welcome");
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="max-w-3xl w-full bg-white p-8 shadow-lg rounded-lg overflow-y-auto max-h-[90vh]">
        <h1 className="text-3xl font-bold text-center text-blue-700 mb-6">Terms & Conditions</h1>

        <div className="space-y-4 text-gray-700 text-sm">
          <p><strong>1. Service Agreement:</strong> BYN connects customers and verified workers. We do not provide services directly.</p>
          <p><strong>2. User Responsibilities:</strong> Users must provide truthful information. Misuse may result in account suspension.</p>
          <p><strong>3. Payments & Fees:</strong> Payments are securely processed. BYN may deduct a service fee. Refunds follow dispute reviews.</p>
          <p><strong>4. Worker Verification:</strong> Workers must submit valid IDs and documents. BYN has the right to approve or reject applications.</p>
          <p><strong>5. Communication:</strong> All chats must stay within the app. Sharing private info before booking is not allowed.</p>
          <p><strong>6. Location & Availability:</strong> Workers must provide accurate service areas. Customers should confirm availability before booking.</p>
          <p><strong>7. Disclaimers:</strong> BYN is not liable for damages or disputes. We help resolve issues but don't guarantee outcomes.</p>
          <p><strong>8. Acceptance:</strong> By continuing, you accept these terms and the BYN Privacy Policy.</p>
        </div>

        <div className="mt-6 flex items-start">
          <input
            type="checkbox"
            id="agree"
            className="mt-1 mr-2"
            checked={agreed}
            onChange={() => setAgreed(!agreed)}
          />
          <label htmlFor="agree" className="text-sm text-gray-700">
            I have read and agree to the <span className="font-medium text-blue-600">Terms & Conditions</span> and Privacy Policy.
          </label>
        </div>

        <button
          onClick={handleAgree}
          disabled={!agreed}
          className={`mt-6 w-full py-3 rounded-lg text-white font-semibold transition ${
            agreed
              ? "bg-blue-600 hover:bg-blue-700"
              : "bg-gray-400 cursor-not-allowed"
          }`}
        >
          I Agree & Continue →
        </button>
      </div>
    </div>
  );
};

export default TermsAndConditions;
