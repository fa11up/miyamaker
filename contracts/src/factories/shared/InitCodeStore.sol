// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SSTORE2 } from "solady/utils/SSTORE2.sol";
import { LibBytes } from "solady/utils/LibBytes.sol";

/// @title InitCodeStore
/// @notice Keeps a collection's creation code out of its factory's runtime bytecode. A factory writes the code to
///         two SSTORE2 data contracts in its constructor (the code is then part of the factory's initcode, capped at
///         49,152 bytes, not its 24,576-byte runtime) and reads it back for each deployment.
library InitCodeStore {
    /// @dev Each data contract holds at most this much. With SSTORE2's 1-byte STOP prefix a data contract could hold
    ///      up to 24,575 bytes under EIP-170's 24,576; 24,000 leaves 575 bytes of margin, so two chunks cover
    ///      48,000 bytes of creation code (InitCodeTooLarge above that).
    uint256 private constant CHUNK = 24_000;

    error InitCodeTooLarge();

    function write(bytes memory code) internal returns (address first, address second) {
        uint256 n = code.length;
        if (n > 2 * CHUNK) revert InitCodeTooLarge();
        if (n <= CHUNK) return (SSTORE2.write(code), address(0));
        first = SSTORE2.write(LibBytes.slice(code, 0, CHUNK));
        second = SSTORE2.write(LibBytes.slice(code, CHUNK, n));
    }

    function read(address first, address second) internal view returns (bytes memory) {
        if (second == address(0)) return SSTORE2.read(first);
        return bytes.concat(SSTORE2.read(first), SSTORE2.read(second));
    }
}
